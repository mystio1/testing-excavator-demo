import { requireBusinessApi } from "@/lib/api-auth";
import { assertAssistantAvailable } from "@/lib/agent/availability";
import { ApiHttpError } from "@/lib/api-error";
import { db } from "@/lib/db";
import { enforceAgentQuota, listenRules } from "@/lib/agent/quota";
import { TRANSCRIBE_MS } from "@/lib/agent/budget";
import { recordListenMetric } from "@/lib/agent/metrics";
import { assertWithinBudget, recordUsage } from "@/lib/agent/usage";
import { json, withApi } from "@/lib/with-api";
import { AGENT_LANGS, type AgentLang } from "@/lib/agent/types";
import { speechPrompt } from "@/lib/agent/vocabulary";
import { usableTranscript } from "@/lib/agent/transcript";
import { transcribeWithIndic, usesIndic } from "@/lib/agent/transcribe";

/**
 * Speech to text, through the server so the key never reaches a browser.
 *
 * The clip is forwarded to Whisper and dropped the moment the text comes back:
 * it is never written to disk, never logged, and nothing about it is kept. The
 * transcript goes to the caller and lives only in their conversation.
 */

const WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
/** Whisper large, which is the one worth using for Marathi and for the
 * Hindi-English mixing people actually speak. */
const WHISPER_MODEL = "whisper-large-v3";

/** A spoken instruction is seconds long. This is a ceiling on cost and on how
 * long a stuck request can hold a connection, not a target. */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
/** Below this there is no speech in the file, only the container. Sending it
 * wastes a request and invites Whisper to invent a sentence. */
const MIN_AUDIO_BYTES = 1024;
const TIMEOUT_MS = TRANSCRIBE_MS;

/** Containers Whisper decodes, by the mime type browsers actually produce:
 * webm/ogg on Chrome and Firefox, mp4 on Safari and iOS. The extension has to
 * match the bytes — a Safari mp4 sent as "speech.webm" is a decode failure
 * that looks exactly like a bad microphone. */
const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};

function filenameFor(type: string): string {
  // "audio/webm;codecs=opus" -> "audio/webm"
  const base = type.split(";")[0]!.trim().toLowerCase();
  return `speech.${EXTENSIONS[base] ?? "webm"}`;
}

export const POST = withApi("agent.listen", async (req) => {
  const auth = await requireBusinessApi();
  if (auth.error) return auth.error;

  // Switched off for this business? Nothing here runs, however the request
  // got here.
  await assertAssistantAvailable(auth.session.businessId);

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new ApiHttpError("BAD_REQUEST", "The assistant is not set up yet.");

  // Before the body is touched. Each clip costs a Whisper call and up to 8 MB
  // of parsing, so a loop here is worth refusing while it is still cheap — and
  // the per-business and global rings keep one yard from spending the shared
  // account's allowance on everyone else's behalf.
  await enforceAgentQuota(
    listenRules({ userId: auth.session.userId, businessId: auth.session.businessId }),
  );

  // The declared length, checked before parsing rather than after: formData()
  // reads the whole upload into memory first, so rejecting afterwards has
  // already paid the cost it was meant to avoid.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES) {
    throw new ApiHttpError("VALIDATION_FAILED", "That recording is too long");
  }

  // Consent is checked HERE, not only in the panel. A disclosure the browser
  // can skip is not a control: this is the one request that carries the owner's
  // voice out of the country, so it refuses without a recorded consent even if
  // a client forgets to ask.
  const consented = await db.user.findFirst({
    where: { id: auth.session.userId, businessId: auth.session.businessId, voiceConsentAt: { not: null } },
    select: { id: true },
  });
  if (!consented) {
    throw new ApiHttpError("FORBIDDEN", "Voice is not switched on for this account yet.");
  }

  const requestStartedAt = Date.now();
  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) throw new ApiHttpError("VALIDATION_FAILED", "No audio was sent");
  if (audio.size === 0) throw new ApiHttpError("VALIDATION_FAILED", "The recording was empty");
  if (audio.size > MAX_AUDIO_BYTES) throw new ApiHttpError("VALIDATION_FAILED", "That recording is too long");
  // Not an error worth a red message: they tapped the microphone twice. Answer
  // with nothing heard, which the panel already knows how to say kindly.
  if (audio.size < MIN_AUDIO_BYTES) return json({ text: "" });

  const raw = form.get("lang");
  const lang: AgentLang = AGENT_LANGS.includes(raw as AgentLang) ? (raw as AgentLang) : "en";

  // Whisper bills by audio length, so that is what is metered. Estimated from
  // the clip's size rather than taken from the client: the recorder is pinned
  // to 48 kbps mono (see use-speech.ts), which is about 6 KB a second, and a
  // figure derived from the bytes cannot be under-reported by a client. An
  // estimate is honest here — this is a meter and a backstop, not an invoice.
  const seconds = Math.max(1, Math.round(audio.size / 6_000));
  await assertWithinBudget(auth.session.businessId, "listen", lang);

  // Hindi and Marathi go to IndicConformer first, which is measured at ten
  // times fewer errors than Whisper on Marathi (see transcribe.ts). It runs in
  // a sidecar, so a null answer means "that service could not help" and the
  // Whisper path below runs instead — a worse transcript beats none at all.
  //
  // Nothing after this point changes: the same screen for invented text, the
  // same metrics, the same empty-string-is-an-answer contract.
  if (usesIndic(lang)) {
    const heard = await transcribeWithIndic(audio, filenameFor(audio.type), lang);
    if (heard !== null) {
      // The phantom screen still applies. It is a different model, but the
      // failure it guards against — writing a fluent sentence over a clip that
      // held no speech — is not specific to Whisper.
      const text = usableTranscript({ text: heard }, "");
      recordListenMetric({
        lang,
        heard: text.length > 0,
        seconds,
        chars: text.length,
        durationMs: Date.now() - requestStartedAt,
      });
      // Metered as audio seconds like any other transcription, so the usage
      // page keeps telling the truth about how much speech was processed —
      // even though this engine costs the account nothing.
      void recordUsage(auth.session.businessId, { listenCalls: 1, listenSeconds: seconds });
      return json({ text });
    }
  }

  const upstream = new FormData();
  upstream.append("file", audio, filenameFor(audio.type));
  upstream.append("model", WHISPER_MODEL);
  // Telling Whisper the language markedly improves Marathi and Hindi over
  // letting it guess from a few noisy seconds.
  upstream.append("language", lang);
  // The owner's own machine, operator, site and customer names. Without them
  // every proper noun is a guess, and a misspelled name matches no record.
  const prompt = await speechPrompt(auth.session.businessId, lang);
  upstream.append("prompt", prompt);
  // This is dictation of names and numbers. There is no better reading of
  // "1200" to go looking for.
  upstream.append("temperature", "0");
  // verbose_json costs nothing extra and carries per-segment confidence. It is
  // a weaker signal than it looks — see transcript.ts, which measures what it
  // does and does not catch — but it does reject an outright silent clip.
  upstream.append("response_format", "verbose_json");

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(WHISPER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
      signal: controller.signal,
    });
    // Metered as soon as the clip has been sent, whatever comes back: the
    // service was used either way, and a meter that only counts successes
    // understates the bill.
    void recordUsage(auth.session.businessId, { listenCalls: 1, listenSeconds: seconds });

    // The upstream body can quote the request, so it is never echoed onward.
    if (!res.ok) throw new ApiHttpError("BAD_REQUEST", "I couldn't hear that. Please try again.");

    const body = (await res.json()) as {
      text?: string;
      segments?: { text?: string; avg_logprob?: number; no_speech_prob?: number; compression_ratio?: number }[];
    };
    // The prompt goes in too: a transcript that is just the vocabulary read
    // back is Whisper filling silence, not the owner speaking.
    const text = usableTranscript(body, prompt);
    // Speech is the half that can be quietly useless: an empty or wrong
    // transcript is not an error, so nothing else would ever notice it.
    recordListenMetric({
      lang,
      heard: text.length > 0,
      seconds,
      chars: text.length,
      durationMs: Date.now() - startedAt,
    });
    return json({ text });
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    throw new ApiHttpError("BAD_REQUEST", "I couldn't hear that. Please try again.");
  } finally {
    clearTimeout(timer);
  }
});
