import { describe, expect, it } from "vitest";
import { usableTranscript } from "@/lib/agent/transcript";
import { normalizeText } from "@/lib/agent/text";
import { __testing } from "@/lib/agent/vocabulary";
import { say } from "@/lib/agent/i18n";

/**
 * The speech half, against the real Whisper.
 *
 * SKIPPED BY DEFAULT, like the model eval — it spends the account's audio
 * allowance. Run it deliberately:
 *
 *     RUN_LISTEN_CHECK=1 npx vitest run tests/eval/listen.test.ts
 *
 * Why it exists: this whole feature began with "things are not converted
 * properly in text from voice", and everything built in answer to that —
 * the vocabulary prompt, the phantom screen in `transcript.ts` — is tested
 * against transcripts written BY HAND. Hand-written fixtures prove the screen's
 * logic. They cannot prove that the live endpoint still accepts the fields we
 * send it, nor that the screen catches what Whisper actually does.
 *
 * Two things are checked, and both need a real call:
 *
 *  1. **The wiring.** A dead model name, a rejected form field, an account that
 *     cannot use `verbose_json` — each of those breaks transcription completely
 *     while every unit test stays green, because the unit tests never make the
 *     request. This is the only check that would catch it.
 *
 *  2. **The screen, against real output.** A clip with no speech in it is the
 *     commonest thing a nervous first-time user produces: they tap the
 *     microphone, hesitate, and tap it again. Whisper does not answer silence
 *     with silence — it invents a sentence, and if we are feeding it the
 *     owner's own machine and operator names it will often hand one of those
 *     back. An invented instruction is worse than no instruction, so what
 *     matters is that NOTHING survives the screen.
 *
 * There is no speech in these clips, which is the point: generating real Hindi
 * speech here is not possible, and a silent clip tests the failure direction
 * that actually hurts. Accuracy on real sentences is measured by hand and by
 * the owner.
 */

const ENABLED = !!process.env.RUN_LISTEN_CHECK && !!process.env.GROQ_API_KEY;

const WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const WHISPER_MODEL = "whisper-large-v3";
const SAMPLE_RATE = 16_000;

type WhisperBody = {
  text?: string;
  segments?: { text?: string; avg_logprob?: number; no_speech_prob?: number; compression_ratio?: number }[];
};

/**
 * A real WAV, built by hand because there is no ffmpeg here.
 *
 * 16 kHz mono 16-bit PCM is what Whisper resamples to anyway, so this is the
 * cheapest honest clip to send. `amplitude` 0 is digital silence; a small value
 * is the hiss a phone actually records in a yard, which is the more realistic
 * of the two and the harder one to screen.
 */
function wav(seconds: number, amplitude: number): Blob {
  const samples = SAMPLE_RATE * seconds;
  const dataBytes = samples * 2;
  const buf = Buffer.alloc(44 + dataBytes);

  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // PCM header length
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);

  if (amplitude > 0) {
    for (let i = 0; i < samples; i += 1) {
      // Deterministic, so a failure can be reproduced exactly.
      const v = Math.round(Math.sin(i * 0.7) * amplitude * ((i % 97) / 97));
      buf.writeInt16LE(v, 44 + i * 2);
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** The vocabulary prompt as the route really sends it: the trade words, then
 * the owner's own names. Built here rather than read from a database, because
 * how it is assembled is already covered by vocabulary.test.ts — what is under
 * test here is what Whisper DOES with it. */
const NAMES = [
  "Komatsu PC200",
  "Tata Hitachi EX200",
  "Banda Patil",
  "Sagar Jadhav",
  "Hinjawadi Phase 2",
  "Shree Constructions",
];

const PROMPT = `${say(__testing.DOMAIN, "hi")} ${NAMES.join(", ")}.`;

/** Every word of the owner's own records, which is what must never come back
 * out of a clip that holds no speech. */
const NAME_WORDS = [...new Set(NAMES.flatMap((n) => normalizeText(n).split(" ")))].filter(
  // A bare number is not evidence of a leak on its own.
  (w) => w.length > 2 && !/^\d+$/.test(w),
);

/** The same fields, in the same order, as src/app/api/agent/listen/route.ts. */
async function transcribe(clip: Blob, lang: string): Promise<{ status: number; body: WhisperBody; raw: string }> {
  const form = new FormData();
  form.append("file", clip, "speech.wav");
  form.append("model", WHISPER_MODEL);
  form.append("language", lang);
  form.append("prompt", PROMPT);
  form.append("temperature", "0");
  form.append("response_format", "verbose_json");

  const res = await fetch(WHISPER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: form,
  });
  const raw = await res.text();
  let body: WhisperBody = {};
  try {
    body = JSON.parse(raw) as WhisperBody;
  } catch {
    // Left empty; the status and raw text are what the assertions report.
  }
  return { status: res.status, body, raw };
}

const CLIPS = [
  { name: "digital silence", clip: () => wav(2, 0) },
  { name: "room hiss, no speech", clip: () => wav(2, 300) },
];

/**
 * Checked without a key and without the network, because this is the one part
 * of the live check that can be wrong in a way that LOOKS like the API's fault.
 *
 * A bad byte in a hand-written header comes back from Whisper as "400 invalid
 * file", which reads exactly like a dead model name or a rejected field — and
 * sends you looking at the wrong thing. So the file we build is verified here,
 * where the failure names itself.
 */
describe("the clip we send is a real WAV", () => {
  it("has a well-formed 16 kHz mono 16-bit PCM header", async () => {
    const bytes = Buffer.from(await wav(2, 0).arrayBuffer());

    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(bytes.subarray(12, 16).toString("ascii")).toBe("fmt ");
    expect(bytes.subarray(36, 40).toString("ascii")).toBe("data");

    expect(bytes.readUInt16LE(20), "not PCM").toBe(1);
    expect(bytes.readUInt16LE(22), "not mono").toBe(1);
    expect(bytes.readUInt32LE(24), "wrong sample rate").toBe(SAMPLE_RATE);
    expect(bytes.readUInt16LE(34), "not 16-bit").toBe(16);
    // byteRate and blockAlign have to agree with the above or decoders read
    // the samples at the wrong speed, which would sound like speech sped up.
    expect(bytes.readUInt32LE(28), "byte rate disagrees").toBe(SAMPLE_RATE * 2);
    expect(bytes.readUInt16LE(32), "block align disagrees").toBe(2);

    // The two declared lengths must match the file we actually produced, or a
    // decoder reads past the end or stops short.
    const dataBytes = SAMPLE_RATE * 2 * 2;
    expect(bytes.readUInt32LE(40), "data length").toBe(dataBytes);
    expect(bytes.readUInt32LE(4), "RIFF length").toBe(36 + dataBytes);
    expect(bytes.length).toBe(44 + dataBytes);
  });

  it("is comfortably over the route's minimum and under its maximum", () => {
    // Below 1 KB the route answers "nothing heard" without calling Whisper, so
    // a clip under it would make the live check pass having tested nothing.
    const size = 44 + SAMPLE_RATE * 2 * 2;
    expect(size).toBeGreaterThan(1024);
    expect(size).toBeLessThan(8 * 1024 * 1024);
  });

  it("puts actual signal in the noise clip and none in the silent one", async () => {
    const silent = Buffer.from(await wav(1, 0).arrayBuffer()).subarray(44);
    const noisy = Buffer.from(await wav(1, 300).arrayBuffer()).subarray(44);

    expect(silent.every((b) => b === 0), "silence is not silent").toBe(true);
    // Without this the "room hiss" case would secretly be a second silence
    // case, and the harder of the two screens would never be exercised.
    expect(noisy.some((b) => b !== 0), "the noise clip is silent").toBe(true);
  });
});

describe.skipIf(!ENABLED)("the live speech endpoint", () => {
  it("still accepts the request this app actually sends", async () => {
    const { status, raw } = await transcribe(wav(2, 0), "hi");
    // A 400 here means the model name, a form field or the response format has
    // stopped being valid for this account — transcription would be dead in
    // production while every other test in the repository passed.
    expect(status, `Whisper refused the request: ${raw.slice(0, 300)}`).toBe(200);
  }, 60_000);

  for (const { name, clip } of CLIPS) {
    it(`invents nothing that could be acted on: ${name}`, async () => {
      const { status, body, raw } = await transcribe(clip(), "hi");
      expect(status, raw.slice(0, 300)).toBe(200);

      const screened = usableTranscript(body, PROMPT);

      // Printed either way, with the per-segment numbers, because those are
      // what the screen in transcript.ts actually judges by. Without them a
      // failure here tells you a hallucination got through but not which
      // threshold let it, and the thresholds are the only thing you can change.
      const diag = (body.segments ?? [])
        .map(
          (seg, i) =>
            `    [${i}] logprob=${seg.avg_logprob?.toFixed(3) ?? "?"} ` +
            `no_speech=${seg.no_speech_prob?.toFixed(3) ?? "?"} ` +
            `compression=${seg.compression_ratio?.toFixed(2) ?? "?"} ${JSON.stringify(seg.text ?? "")}`,
        )
        .join("\n");
      console.log(
        `\n[${name}]\n  Whisper said : ${JSON.stringify(body.text ?? "")}\n` +
          `  after screen : ${JSON.stringify(screened)}\n` +
          `  segments     : ${body.segments?.length ?? 0}\n${diag}\n`,
      );

      // What this layer can promise, and what it cannot.
      //
      // It CANNOT promise "". Sampled across runs, the same silent clip
      // produced a repeated word ("प्रदावाद प्रदावाद"), a single fragment
      // ("झाल") and a fluent eight-word Hindi sentence with no repeats in it
      // ("प्रदान करने के लिए आपको प्रतिमान करना चाहिए."). Nothing at the
      // transcript layer can tell that last one from speech — and the numbers
      // are no help either, since it arrived at avg_logprob -0.204, better
      // than Whisper gives a clear real sentence. Asserting "" here would be
      // asserting something this code does not do, and the test would fail on
      // Whisper's mood rather than on a regression.
      //
      // What it CAN promise is the property that makes a phantom dangerous:
      // that it never comes back wearing the owner's own record names. Those
      // are the values that get matched to a machine, an operator, a site, a
      // customer and then acted on. A sentence that names nothing real reaches
      // the matcher, finds no record, and costs a wasted turn instead of a
      // wrong record — which is the layered defence doing its job.
      const leaked = NAME_WORDS.filter((w) => normalizeText(screened).split(" ").includes(w));
      expect(leaked, `the owner's own records came back out of silence: "${screened}"`).toEqual([]);

      // There is deliberately no assertion here that nothing repeats.
      //
      // Sampled further, silence also produced "जब आपको शरीर देखते हैं, तो
      // आपको शरीर देखते हैं." — the same phrase twice, which is a loop by any
      // reading, and which the word-count rule misses because the phrase
      // itself has five distinct words in it (6 of 10 overall, against a 0.55
      // threshold). A phrase-repeat rule would catch it.
      //
      // It is not worth having. Weigh the two mistakes: a phrase loop that
      // gets through names no machine, operator, site or customer, so it
      // reaches the matcher, finds no record, and ends in a question — one
      // wasted turn. A rule tight enough to catch it also catches an owner
      // repeating a four-word command verbatim, which is also one wasted turn.
      // Equal cost in both directions buys nothing, and a safety screen nobody
      // can reason about is its own hazard.
      //
      // So the measured loop shapes are pinned in transcript.test.ts, where
      // they are exact and cannot flake, and the only thing asserted against
      // the live endpoint is the promise above — which has held on every run.
    }, 60_000);
  }
});
