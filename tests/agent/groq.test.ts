import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askGroq, buildSystemPrompt, GroqError, parseRetryAfter as parseRetryAfterFrom } from "@/lib/agent/groq";

/**
 * The adapter's job is to come back with something the orchestrator can act on
 * or a reason it can explain — never a half-understood blob. No key and no
 * network call: the fetch is injected.
 */

const KEY = "test-key-not-a-real-one";

/** A Groq chat completion whose message content is `content`. */
const reply = (content: string) =>
  vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }),
  ) as unknown as typeof fetch;

const ask = (fetchImpl: typeof fetch) =>
  askGroq({ lang: "en", history: [{ role: "user", content: "hi" }] }, { apiKey: KEY, fetchImpl });

describe("system prompt", () => {
  it("lists capabilities and their field names, but never routes or controls", () => {
    const prompt = buildSystemPrompt("mr");
    expect(prompt).toContain("work.start");
    expect(prompt).toContain("Marathi");
    // Field NAMES are given, or the model invents its own and the value the
    // owner already said gets dropped on the way in.
    expect(prompt).toContain("startHourMeter");
    // Routes and control ids are the plumbing, and stay server-side.
    expect(prompt).not.toContain("/excavators");
    expect(prompt).not.toContain("data-agent-id");
    expect(prompt).not.toContain("start-work-submit");
    expect(prompt).not.toContain("machine-card");
  });

  it("tells the model it cannot confirm its own actions", () => {
    // Asserted on the property, not the sentence: the wording was compressed
    // when the prompt was trimmed (it is re-sent on every turn and is almost
    // the whole token cost of one), and a test that pins the phrasing just
    // breaks on every edit without protecting anything.
    const prompt = buildSystemPrompt("en");
    expect(prompt).toMatch(/never confirm/i);
    expect(prompt).toMatch(/the app asks the owner/i);
  });
});

describe("responses are parsed, not trusted", () => {
  it("returns a proposed action", async () => {
    const out = await ask(reply('{"kind":"action","workflowId":"work.start","fields":{"site":"Wakad"}}'));
    expect(out).toEqual({ kind: "action", workflowId: "work.start", fields: { site: "Wakad" } });
  });

  it("returns a clarifying question", async () => {
    const out = await ask(reply('{"kind":"clarify","field":"operator","question":"Which Patil?"}'));
    expect(out).toMatchObject({ kind: "clarify", question: "Which Patil?" });
  });

  it("refuses a self-granted confirmation", async () => {
    await expect(
      ask(reply('{"kind":"action","workflowId":"work.start","fields":{},"confirmed":true}')),
    ).rejects.toThrow(GroqError);
  });

  it("refuses a request to run code", async () => {
    await expect(ask(reply('{"kind":"runScript","code":"fetch(\'/api\')"}'))).rejects.toThrow(GroqError);
  });

  it("refuses prose where JSON was required", async () => {
    await expect(ask(reply("Sure, I've added the trip!"))).rejects.toThrow(/required format/);
  });
});

describe("failures are explainable", () => {
  it("says so when the key is missing rather than calling out", async () => {
    // Hermetic on purpose: this must fail the same way on a machine that has a
    // real key in .env as on one that does not.
    vi.stubEnv("GROQ_API_KEY", "");
    try {
      const fetchImpl = vi.fn() as unknown as typeof fetch;
      await expect(
        askGroq({ lang: "en", history: [] }, { apiKey: undefined, fetchImpl }),
      ).rejects.toMatchObject({ kind: "no_key" });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reports an HTTP failure without quoting the response body back", async () => {
    const fetchImpl = vi.fn(async () => new Response("key sk-leaked", { status: 401 })) as unknown as typeof fetch;
    const err = await ask(fetchImpl).catch((e: GroqError) => e);
    expect(err).toBeInstanceOf(GroqError);
    expect((err as GroqError).kind).toBe("http");
    expect((err as GroqError).message).not.toContain("sk-leaked");
  });

  it("gives up rather than hanging the turn", async () => {
    const fetchImpl = vi.fn((_url: unknown, init?: { signal?: AbortSignal }) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    }) as unknown as typeof fetch;

    await expect(
      askGroq({ lang: "en", history: [] }, { apiKey: KEY, fetchImpl, timeoutMs: 10 }),
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("never puts the key in the error it shows a user", async () => {
    const err = await ask(reply("not json")).catch((e: GroqError) => e);
    expect((err as GroqError).message).not.toContain(KEY);
  });
});

describe("the request itself", () => {
  it("sends the key as a bearer header and asks for JSON back", async () => {
    const fetchImpl = reply('{"kind":"reply","message":"ok"}');
    await ask(fetchImpl);

    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);

    const body = JSON.parse(init.body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].role).toBe("system");
    // Extraction, not creativity: a creative reading of "1200" is never better.
    expect(body.temperature).toBeLessThanOrEqual(0.2);
  });
});

describe("a model that fails JSON mode is given one more chance", () => {
  /** Groq reports the model's own JSON-mode failure as a 400 with this text.
   * Measured against the real service: a one-word Marathi greeting triggered
   * it, non-deterministically, and the owner saw "something went wrong". */
  const jsonFailure = () =>
    new Response(
      JSON.stringify({ error: { message: "Failed to generate JSON. Please adjust your prompt." } }),
      { status: 400, headers: { "content-type": "application/json" } },
    );

  const ok = (body: unknown) =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("tells the model what was wrong instead of repeating itself", async () => {
    // The retry used to resend the identical request. Measured against the
    // real service: the first attempt and the retry both came back with a
    // failed_generation of exactly 181 characters — the same input at
    // temperature 0.1 gives the same answer, so the second call bought
    // nothing but another few seconds of the owner waiting.
    const sent: { role: string; content: string }[][] = [];
    let calls = 0;
    const fetchImpl = (async (_url: unknown, init?: { body?: string }) => {
      calls += 1;
      const body = JSON.parse(init?.body ?? "{}") as { messages: { role: string; content: string }[] };
      sent.push(body.messages);
      return calls === 1 ? jsonFailure() : ok({ kind: "reply", message: "ok" });
    }) as unknown as typeof fetch;

    await askGroq({ lang: "en", history: [{ role: "user", content: "hi" }] }, { apiKey: "k", fetchImpl });

    expect(sent).toHaveLength(2);
    // The first attempt carries no correction — there is nothing to correct yet.
    expect(sent[0]!.some((m) => /not valid JSON/i.test(m.content))).toBe(false);
    // The second does, and it comes last so it is the most recent instruction.
    const retry = sent[1]!;
    expect(retry.at(-1)!.content).toMatch(/not valid JSON/i);
    expect(retry.at(-1)!.content).toMatch(/exactly one JSON object/i);
    // And the owner's own words are still there: a correction, not a replacement.
    expect(retry.some((m) => m.content === "hi")).toBe(true);
  });

  it("does not add the correction when the failure was not about JSON", async () => {
    // A timeout or a 500 says nothing about formatting, and telling the model
    // its JSON was bad when it never answered would be noise in the prompt.
    let calls = 0;
    const sent: { role: string; content: string }[][] = [];
    const fetchImpl = (async (_url: unknown, init?: { body?: string }) => {
      calls += 1;
      const body = JSON.parse(init?.body ?? "{}") as { messages: { role: string; content: string }[] };
      sent.push(body.messages);
      return calls === 1
        ? new Response("upstream fell over", { status: 500 })
        : ok({ kind: "reply", message: "ok" });
    }) as unknown as typeof fetch;

    await askGroq({ lang: "en", history: [{ role: "user", content: "hi" }] }, { apiKey: "k", fetchImpl });

    expect(sent).toHaveLength(2);
    expect(sent[1]!.some((m) => /not valid JSON/i.test(m.content))).toBe(false);
  });

  it("retries once and returns the second answer", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls === 1 ? jsonFailure() : ok({ kind: "reply", message: "नमस्कार" });
    }) as unknown as typeof fetch;

    const answer = await askGroq({ lang: "mr", history: [{ role: "user", content: "नमस्ते" }] }, { apiKey: "k", fetchImpl });
    expect(answer).toEqual({ kind: "reply", message: "नमस्कार" });
    expect(calls).toBe(2);
  });

  it("gives up after the second failure rather than looping", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonFailure();
    }) as unknown as typeof fetch;

    await expect(
      askGroq({ lang: "mr", history: [{ role: "user", content: "नमस्ते" }] }, { apiKey: "k", fetchImpl }),
    ).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it("does not retry being over the rate limit", async () => {
    // Asking twice as fast is the one thing that cannot help here.
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429 });
    }) as unknown as typeof fetch;

    await expect(
      askGroq({ lang: "hi", history: [{ role: "user", content: "hi" }] }, { apiKey: "k", fetchImpl }),
    ).rejects.toMatchObject({ kind: "rate_limited" });
    expect(calls).toBe(1);
  });
});

describe("when the service itself is in trouble", () => {
  const down = () => new Response("gateway", { status: 502 });
  const ok = (body: unknown) =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  beforeEach(async () => {
    const { __resetBreaker } = await import("@/lib/agent/groq");
    __resetBreaker();
  });

  it("stops calling after repeated failures, so the owner waits once not five times", async () => {
    // Every failed turn sits for the full timeout before apologising, and the
    // owner reasonably tries again. Four taps became nearly a minute of
    // staring at a phone.
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return down();
    }) as unknown as typeof fetch;

    const ask = () => askGroq({ lang: "en", history: [{ role: "user", content: "hi" }] }, { apiKey: "k", fetchImpl });

    for (let i = 0; i < 4; i += 1) await expect(ask()).rejects.toThrow();
    const callsBefore = calls;

    // The breaker is open now: this one must not reach the network at all.
    await expect(ask()).rejects.toMatchObject({ kind: "unavailable" });
    expect(calls).toBe(callsBefore);
  });

  it("closes again once the service answers", async () => {
    let healthy = false;
    const fetchImpl = (async () => (healthy ? ok({ kind: "reply", message: "back" }) : down())) as unknown as typeof fetch;
    const ask = () => askGroq({ lang: "en", history: [{ role: "user", content: "hi" }] }, { apiKey: "k", fetchImpl });

    for (let i = 0; i < 4; i += 1) await expect(ask()).rejects.toThrow();
    healthy = true;

    // After the cooldown one request is let through to find out. With the
    // cooldown shortened for the test, that is the next one.
    const { __resetBreaker } = await import("@/lib/agent/groq");
    __resetBreaker();
    await expect(ask()).resolves.toEqual({ kind: "reply", message: "back" });
  });

  it("does not trip the breaker on the owner's own rate limit", async () => {
    // Being over an allowance says nothing about whether the service is well.
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429 });
    }) as unknown as typeof fetch;
    const ask = () => askGroq({ lang: "en", history: [{ role: "user", content: "hi" }] }, { apiKey: "k", fetchImpl });

    for (let i = 0; i < 6; i += 1) await expect(ask()).rejects.toMatchObject({ kind: "rate_limited" });
    // Still reaching the network: one call per attempt, never short-circuited.
    expect(calls).toBe(6);
  });
});

describe("a second model, when the first cannot answer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** The env var is read when the module loads, so the module is reloaded. */
  async function withFallback(fallback: string | undefined) {
    vi.stubEnv("GROQ_MODEL", "primary-model");
    if (fallback === undefined) vi.stubEnv("GROQ_MODEL_FALLBACK", "");
    else vi.stubEnv("GROQ_MODEL_FALLBACK", fallback);
    vi.resetModules();
    return import("@/lib/agent/groq");
  }

  const modelsAsked = (calls: string[]) => calls;

  it("tries the fallback when the first model is gone", async () => {
    // Measured during development: a model name that had been working stopped
    // existing (404 model_not_found), and with one name in one env var the
    // assistant was down until somebody noticed and deployed.
    const groq = await withFallback("second-model");
    const asked: string[] = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      const model = (JSON.parse(init.body) as { model: string }).model;
      asked.push(model);
      if (model === "primary-model") {
        return new Response(JSON.stringify({ error: { message: "model_not_found" } }), { status: 404 });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ kind: "reply", message: "ok" }) } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const answer = await groq.askGroq(
      { lang: "en", history: [{ role: "user", content: "hi" }] },
      { apiKey: "k", fetchImpl },
    );
    expect(answer).toEqual({ kind: "reply", message: "ok" });
    expect(modelsAsked(asked)).toEqual(["primary-model", "primary-model", "second-model"]);
  });

  it("does not spend a fallback attempt on the owner's rate limit", async () => {
    const groq = await withFallback("second-model");
    const asked: string[] = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      asked.push((JSON.parse(init.body) as { model: string }).model);
      return new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429 });
    }) as unknown as typeof fetch;

    await expect(
      groq.askGroq({ lang: "en", history: [{ role: "user", content: "hi" }] }, { apiKey: "k", fetchImpl }),
    ).rejects.toMatchObject({ kind: "rate_limited" });
    // A second model on the same account is over the same limit.
    expect(asked).toEqual(["primary-model"]);
  });

  it("works with no fallback configured, which is the default", async () => {
    const groq = await withFallback(undefined);
    expect(groq.GROQ_MODEL_FALLBACK).toBeNull();
    const asked: string[] = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      asked.push((JSON.parse(init.body) as { model: string }).model);
      return new Response("bad gateway", { status: 502 });
    }) as unknown as typeof fetch;

    await expect(
      groq.askGroq({ lang: "en", history: [{ role: "user", content: "hi" }] }, { apiKey: "k", fetchImpl }),
    ).rejects.toThrow();
    expect(asked).toEqual(["primary-model", "primary-model"]);
  });
});

describe("a model chosen per business", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function load(allowed: string) {
    vi.stubEnv("GROQ_MODEL", "house-model");
    vi.stubEnv("GROQ_MODELS_ALLOWED", allowed);
    vi.resetModules();
    return import("@/lib/agent/groq");
  }

  it("uses the deployment's model when a business has no preference", async () => {
    const groq = await load("");
    expect(groq.modelFor(null)).toBe("house-model");
    expect(groq.modelFor(undefined)).toBe("house-model");
    expect(groq.modelFor("  ")).toBe("house-model");
  });

  it("honours an override the deployment allows", async () => {
    // One customer moved to a better model without moving everyone.
    const groq = await load("trial-model,other-model");
    expect(groq.modelFor("trial-model")).toBe("trial-model");
  });

  it("ignores one it does not, rather than trusting a database row", async () => {
    // An arbitrary string here would be a way to point this business's
    // spending at an unknown model, and the shared account pays for it.
    const groq = await load("trial-model");
    expect(groq.modelFor("something-nobody-approved")).toBe("house-model");
  });

  it("actually asks the chosen model", async () => {
    const groq = await load("trial-model");
    const asked: string[] = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      asked.push((JSON.parse(init.body) as { model: string }).model);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ kind: "reply", message: "ok" }) } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await groq.askGroq(
      { lang: "en", history: [{ role: "user", content: "hi" }] },
      { apiKey: "k", fetchImpl, model: groq.modelFor("trial-model") },
    );
    expect(asked).toEqual(["trial-model"]);
  });

  it("does not retry the same model twice as a 'fallback'", async () => {
    // When a business is already on the deployment's fallback, a third attempt
    // at it is just a longer wait for the same answer.
    vi.stubEnv("GROQ_MODEL", "house-model");
    vi.stubEnv("GROQ_MODEL_FALLBACK", "trial-model");
    vi.stubEnv("GROQ_MODELS_ALLOWED", "trial-model");
    vi.resetModules();
    const groq = await import("@/lib/agent/groq");

    const asked: string[] = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      asked.push((JSON.parse(init.body) as { model: string }).model);
      return new Response("bad gateway", { status: 502 });
    }) as unknown as typeof fetch;

    await expect(
      groq.askGroq(
        { lang: "en", history: [{ role: "user", content: "hi" }] },
        { apiKey: "k", fetchImpl, model: "trial-model" },
      ),
    ).rejects.toThrow();
    expect(asked).toEqual(["trial-model", "trial-model"]);
  });
});

describe("telling a minute's wait from a day's", () => {
  it("reads the wait out of what the service actually said", async () => {
    // Measured, verbatim: the same 429 means two very different things, and
    // only this string distinguishes them.
    const { parseRetryAfter } = await import("@/lib/agent/groq");
    expect(
      parseRetryAfter(
        "Rate limit reached for model `qwen/qwen3.8-27b` on tokens per day (TPD): Limit 200000, Used 199860, Requested 1450. Please try again in 9m25.92s.",
      ),
    ).toBe(566);
    expect(parseRetryAfter("Please try again in 44.5s")).toBe(45);
    expect(parseRetryAfter("Please try again in 2m0s")).toBe(120);
  });

  it("says nothing rather than guessing when the service did not", () => {
    expect(parseRetryAfterFrom("slow down")).toBeUndefined();
    expect(parseRetryAfterFrom("")).toBeUndefined();
  });

  it("carries the wait on the error, so a retry loop can tell the difference", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          error: { message: "tokens per day (TPD): Limit 200000, Used 199999. Please try again in 9m25.92s" },
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    const err = await askGroq(
      { lang: "en", history: [{ role: "user", content: "hi" }] },
      { apiKey: "k", fetchImpl },
    ).catch((e: unknown) => e);

    expect(err).toMatchObject({ kind: "rate_limited", retryAfterSec: 566 });
  });
});
