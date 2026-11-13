import { logger } from "@/lib/logger";
import { TRANSCRIBE_MS } from "./budget";
import { AGENT_LANGS, type AgentLang } from "./types";

/**
 * Which engine hears which language.
 *
 * Whisper is good at English and bad at Marathi. That is not an impression —
 * measured on 12 Marathi clips against reference transcripts
 * (`services/indic-asr/README.md` has the harness):
 *
 *     IndicConformer RNNT   WER 0.067
 *     IndicConformer CTC    WER 0.101
 *     Whisper large-v3      WER 0.653
 *
 * Ten times fewer errors. And Whisper does not simply misspell Marathi, it
 * drops words and slides into Hindi — "है" where the speaker said "आहे" —
 * which is how a clear instruction ends up matching no record at all.
 *
 * So the engine is chosen per language rather than once for the app. English
 * stays on Whisper, which is better at it and already paid for; the Indic
 * languages go to IndicConformer when it is reachable.
 *
 * ## Falling back is the point
 *
 * The Indic model runs in a sidecar (`services/indic-asr`), which is one more
 * thing that can be down. When it is, this falls back to Whisper rather than
 * failing the turn. A worse transcript is recoverable — the owner hears the
 * approval card read back and can say no. No transcript at all, in a yard, is
 * the end of the conversation.
 */

/** Where the sidecar lives. Unset means "not deployed": everything uses
 * Whisper, which is exactly the behaviour before this existed. */
const INDIC_URL = process.env.INDIC_ASR_URL?.replace(/\/+$/, "") ?? "";

/**
 * Shared secret for a sidecar that is not on localhost.
 *
 * Once the service has a public address it is an open speech-to-text endpoint,
 * and on a free instance one abuser is the whole instance. Optional, because a
 * sidecar bound to 127.0.0.1 in development needs no token.
 */
const INDIC_TOKEN = process.env.INDIC_ASR_TOKEN ?? "";

/**
 * Languages to send to the sidecar, when there is one.
 *
 * Defaults to Hindi and Marathi: those are the languages this was measured on
 * and the ones the owner actually speaks. The rest of the Indic set is
 * supported by the model but unmeasured here, so it is opt-in through
 * INDIC_ASR_LANGS rather than assumed.
 */
const INDIC_LANGS: readonly AgentLang[] = (() => {
  const raw = process.env.INDIC_ASR_LANGS;
  if (!raw) return ["hi", "mr"];
  const asked = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is AgentLang => (AGENT_LANGS as readonly string[]).includes(s));
  return asked;
})();

/**
 * How long to wait for the sidecar before giving up and using Whisper.
 *
 * Deliberately a fraction of TRANSCRIBE_MS. The fallback costs a whole second
 * attempt, so the two together still have to fit inside the budget the owner
 * is waiting through — and the sidecar answers a spoken instruction in well
 * under a second when it is healthy (0.12x realtime, measured), so a wait this
 * long already means something is wrong.
 */
const INDIC_TIMEOUT_MS = Math.round(TRANSCRIBE_MS / 3);

export type Transcription = {
  text: string;
  /** Which engine actually produced it, for metrics and for the bill. */
  engine: "indic-conformer" | "whisper";
};

export const usesIndic = (lang: AgentLang): boolean =>
  INDIC_URL.length > 0 && INDIC_LANGS.includes(lang);

/** For diagnostics and the settings page: what is configured, without leaking
 * the URL itself. */
export const indicStatus = () => ({
  configured: INDIC_URL.length > 0,
  languages: [...INDIC_LANGS],
});

/**
 * Ask the sidecar. Returns null when it cannot answer, for any reason —
 * unreachable, slow, erroring, or handing back nothing usable — because every
 * one of those means the same thing to the caller: use Whisper instead.
 */
export async function transcribeWithIndic(
  audio: Blob,
  filename: string,
  lang: AgentLang,
): Promise<string | null> {
  if (!usesIndic(lang)) return null;

  const form = new FormData();
  form.append("audio", audio, filename);
  form.append("lang", lang);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INDIC_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const res = await fetch(`${INDIC_URL}/transcribe`, {
      method: "POST",
      body: form,
      signal: controller.signal,
      ...(INDIC_TOKEN ? { headers: { Authorization: `Bearer ${INDIC_TOKEN}` } } : {}),
    });
    if (!res.ok) {
      // The body can quote the request, so it is summarised rather than echoed.
      logger.warn("asr.indic_refused", { status: res.status, lang });
      return null;
    }
    const body = (await res.json()) as { text?: string };
    const text = (body.text ?? "").trim();
    logger.info("asr.indic_ok", { lang, ms: Date.now() - startedAt, chars: text.length });
    // An empty answer is a real answer — the clip held no speech — and must
    // NOT fall through to Whisper, or a silent clip would be transcribed twice
    // and Whisper would invent a sentence over it.
    return text;
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    logger.warn("asr.indic_unavailable", {
      lang,
      reason: aborted ? "timeout" : "unreachable",
      ms: Date.now() - startedAt,
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
