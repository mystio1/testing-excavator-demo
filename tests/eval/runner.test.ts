import { describe, expect, it } from "vitest";
import { format, isModelAtFault, report, type Scored } from "./score";
import type { EvalCase } from "./corpus";

/**
 * The eval's own scoring, tested.
 *
 * This exists because the thing it checks silently did not work. A run hit the
 * account's per-minute ceiling on its last four cases and reported them as the
 * agent getting them wrong — which makes the headline number depend on how
 * fast the suite happened to run, and would let a real regression hide behind
 * that noise. A harness nobody checks is a harness that lies quietly.
 */

const cases: EvalCase[] = [
  { id: "a", lang: "hi", text: "one", category: "read", expect: { kind: "reply" } },
  { id: "b", lang: "hi", text: "two", category: "read", expect: { kind: "reply" } },
  { id: "c", lang: "mr", text: "three", category: "conversation", expect: { kind: "reply" } },
  { id: "d", lang: "en", text: "four", category: "safety", expect: { kind: "reply" } },
];

const pass = (id: string): Scored => ({ id, passed: true, failures: [] });
const fail = (id: string): Scored => ({
  id,
  passed: false,
  failures: [{ kind: "workflow", detail: "chose the wrong thing" }],
});
const skip = (id: string): Scored => ({ id, passed: false, skipped: true, failures: [] });

describe("a case the account refused to answer", () => {
  it("is set aside, not counted as the agent being wrong", () => {
    const result = report(cases, [pass("a"), pass("b"), skip("c"), skip("d")]);

    // Two answered, two never reached the model.
    expect(result.total).toBe(2);
    expect(result.passed).toBe(2);
    expect(result.skipped).toBe(2);
    // 100% of what was actually asked — not 50%, which would be a lie about
    // the agent.
    expect(result.passed / result.total).toBe(1);
  });

  it("does not appear in the failures, which are for real verdicts", () => {
    const result = report(cases, [pass("a"), pass("b"), skip("c"), fail("d")]);
    expect(result.failures.map((f) => f.id)).toEqual(["d"]);
  });

  it("is named in the report, so nobody mistakes a thin run for a good one", () => {
    const result = report(cases, [pass("a"), skip("b"), skip("c"), skip("d")]);
    const text = format(result, "some-model");
    expect(text).toMatch(/not answered/i);
    expect(text).toContain("b, c, d");
  });

  it("leaves no trace in the report when nothing was skipped", () => {
    const result = report(cases, cases.map((c) => pass(c.id)));
    expect(format(result, "m")).not.toMatch(/not answered/i);
    expect(result.skipped).toBe(0);
  });

  it("is left out of the per-language and per-category counts too", () => {
    // Otherwise a language whose cases all went unanswered reads as 0%, which
    // is how "mr 0/4" got mistaken for a Marathi regression.
    const result = report(cases, [pass("a"), pass("b"), skip("c"), pass("d")]);
    expect(result.byLang.mr).toBeUndefined();
    expect(result.byCategory.conversation).toBeUndefined();
    expect(result.byLang.hi).toEqual({ total: 2, passed: 2 });
  });
});

describe("a real failure is still a real failure", () => {
  it("counts against the score and is listed with its reason", () => {
    const result = report(cases, [pass("a"), fail("b"), pass("c"), pass("d")]);
    expect(result.passed).toBe(3);
    expect(result.total).toBe(4);
    expect(result.skipped).toBe(0);
    expect(format(result, "m")).toContain("chose the wrong thing");
  });
});

describe("telling the model being wrong from the service not answering", () => {
  /** Shaped like a GroqError, which is all the classifier looks at. */
  const groqError = (kind: string) => Object.assign(new Error(kind), { kind });

  it("scores an answer that came back unusable", () => {
    // Something was returned and could not be used. That is the model's doing
    // and belongs in the number.
    expect(isModelAtFault(groqError("malformed"))).toBe(true);
    expect(isModelAtFault(groqError("no_json"))).toBe(true);
  });

  it("sets aside every way the service can fail to answer", () => {
    // The one that actually happened: rate limits tripped the circuit breaker,
    // the breaker threw `unavailable`, and a Hindi write case was reported as
    // the agent misunderstanding a sentence it was never shown.
    expect(isModelAtFault(groqError("unavailable"))).toBe(false);
    expect(isModelAtFault(groqError("timeout"))).toBe(false);
    expect(isModelAtFault(groqError("http"))).toBe(false);
    expect(isModelAtFault(groqError("rate_limited"))).toBe(false);
    expect(isModelAtFault(groqError("no_key"))).toBe(false);
  });

  it("is loud about an error that is not the model's at all", () => {
    // A bug in the harness or the app must never be filed quietly as "the
    // account was busy" — that is how a broken eval reports a healthy score.
    expect(isModelAtFault(new TypeError("cannot read properties of undefined"))).toBe(true);
    expect(isModelAtFault("something thrown that is not an Error")).toBe(true);
    expect(isModelAtFault(null)).toBe(true);
  });
});
