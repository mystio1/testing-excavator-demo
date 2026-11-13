import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which engine hears which language, and what happens when it cannot.
 *
 * The Indic model lives in a sidecar, so it is one more thing that can be
 * down. Everything here is about that: the choice is per language, and a
 * sidecar that cannot answer must hand the turn back to Whisper rather than
 * end it. A worse transcript is recoverable — the values are read aloud for
 * approval before anything is written. No transcript, in a yard, is the end of
 * the conversation.
 *
 * The module reads its configuration once at import, so each case imports it
 * fresh with the environment it is describing.
 */

const ORIGINAL = { ...process.env };

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import("@/lib/agent/transcribe");
}

beforeEach(() => {
  delete process.env.INDIC_ASR_URL;
  delete process.env.INDIC_ASR_LANGS;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

const clip = () => new Blob([new Uint8Array(4096)], { type: "audio/webm" });

describe("choosing the engine", () => {
  it("uses Whisper for everything when no sidecar is configured", async () => {
    const { usesIndic } = await load({ INDIC_ASR_URL: undefined });
    // Exactly the behaviour before any of this existed.
    for (const lang of ["en", "hi", "mr"] as const) {
      expect(usesIndic(lang), lang).toBe(false);
    }
  });

  it("sends Hindi and Marathi to the sidecar when there is one", async () => {
    const { usesIndic } = await load({ INDIC_ASR_URL: "http://127.0.0.1:8081" });
    expect(usesIndic("hi")).toBe(true);
    expect(usesIndic("mr")).toBe(true);
  });

  it("keeps English on Whisper, which is better at it", async () => {
    const { usesIndic } = await load({ INDIC_ASR_URL: "http://127.0.0.1:8081" });
    expect(usesIndic("en")).toBe(false);
  });

  it("does not assume the languages nobody measured", async () => {
    // The model serves 22 languages; two of them were benchmarked. The rest
    // are opt-in rather than quietly switched over.
    const { usesIndic } = await load({ INDIC_ASR_URL: "http://127.0.0.1:8081" });
    expect(usesIndic("ta")).toBe(false);
    expect(usesIndic("bn")).toBe(false);
  });

  it("lets the list be set explicitly", async () => {
    const { usesIndic } = await load({
      INDIC_ASR_URL: "http://127.0.0.1:8081",
      INDIC_ASR_LANGS: "hi,mr,ta",
    });
    expect(usesIndic("ta")).toBe(true);
    expect(usesIndic("bn")).toBe(false);
  });

  it("ignores a language that is not one of ours", async () => {
    const { usesIndic } = await load({
      INDIC_ASR_URL: "http://127.0.0.1:8081",
      INDIC_ASR_LANGS: "hi,klingon",
    });
    expect(usesIndic("hi")).toBe(true);
    expect(indicLangs(await load({ INDIC_ASR_URL: "http://x", INDIC_ASR_LANGS: "hi,klingon" }))).toEqual(["hi"]);
  });
});

/** The configured list, as the diagnostics endpoint reports it. */
const indicLangs = (mod: { indicStatus: () => { languages: string[] } }) =>
  mod.indicStatus().languages;

describe("when the sidecar cannot answer", () => {
  const url = "http://127.0.0.1:8081";

  it("returns null so the caller falls back to Whisper", async () => {
    const { transcribeWithIndic } = await load({ INDIC_ASR_URL: url });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(await transcribeWithIndic(clip(), "speech.webm", "mr")).toBeNull();
  });

  it("returns null on a refusal rather than passing an error along as speech", async () => {
    const { transcribeWithIndic } = await load({ INDIC_ASR_URL: url });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    expect(await transcribeWithIndic(clip(), "speech.webm", "hi")).toBeNull();
  });

  it("gives up well inside the transcription budget", async () => {
    const { transcribeWithIndic } = await load({ INDIC_ASR_URL: url });
    // A sidecar that accepts the connection and then never answers is the
    // worst case: without its own deadline the owner waits out the whole
    // budget and then still has to wait for Whisper.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      ),
    );
    const { TRANSCRIBE_MS } = await import("@/lib/agent/budget");
    const started = Date.now();
    const answer = await transcribeWithIndic(clip(), "speech.webm", "mr");
    expect(answer).toBeNull();
    expect(Date.now() - started).toBeLessThan(TRANSCRIBE_MS);
  }, 30_000);

  it("is never asked at all for a language it does not serve", async () => {
    const { transcribeWithIndic } = await load({ INDIC_ASR_URL: url });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await transcribeWithIndic(clip(), "speech.webm", "en")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("when the sidecar answers", () => {
  const url = "http://127.0.0.1:8081";
  const ok = (text: string) =>
    vi.fn(async () => new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

  it("hands back what it heard", async () => {
    const { transcribeWithIndic } = await load({ INDIC_ASR_URL: url });
    vi.stubGlobal("fetch", ok("कोमात्सु चालू करा"));
    expect(await transcribeWithIndic(clip(), "speech.webm", "mr")).toBe("कोमात्सु चालू करा");
  });

  it("treats 'nothing was said' as an answer, not as a failure", async () => {
    // The distinction the whole fallback turns on. An empty string means the
    // clip held no speech, and that is a RESULT — the panel says "I didn't
    // catch that". Falling through to Whisper here would hand a silent clip to
    // a model that reliably invents a sentence over silence.
    const { transcribeWithIndic } = await load({ INDIC_ASR_URL: url });
    vi.stubGlobal("fetch", ok("   "));
    expect(await transcribeWithIndic(clip(), "speech.webm", "mr")).toBe("");
  });

  it("sends the audio and the language the way the service expects", async () => {
    const { transcribeWithIndic } = await load({ INDIC_ASR_URL: url });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: "ठीक" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await transcribeWithIndic(clip(), "speech.webm", "hi");

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, { body: FormData }];
    expect(calledUrl).toBe(`${url}/transcribe`);
    expect(init.body.get("lang")).toBe("hi");
    expect(init.body.get("audio")).toBeInstanceOf(Blob);
  });

  it("does not care about a trailing slash in the configured URL", async () => {
    const { transcribeWithIndic } = await load({ INDIC_ASR_URL: `${url}/` });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await transcribeWithIndic(clip(), "speech.webm", "mr");
    expect(fetchMock.mock.calls[0]![0]).toBe(`${url}/transcribe`);
  });
});
