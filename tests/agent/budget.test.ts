import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTROL_MS,
  MAX_RECORDING_MS,
  MODEL_MS,
  SETTLE_MS,
  SUMMARY_MS,
  TRANSCRIBE_MS,
  TURN_BUDGET_MS,
  VERIFY_MS,
  worstCaseReadMs,
  worstCaseSilentMs,
  worstCaseWriteMs,
} from "@/lib/agent/budget";

/**
 * How long the owner can be made to wait — added up, not assumed.
 *
 * Each timeout used to be a number beside the code that used it, which is fine
 * until you total them. A read is four waits in a row (understand, navigate,
 * verify, summarise) and nothing said what that could reach: it was 40
 * seconds. Somebody holding a phone in a yard does not wait 40 seconds, they
 * tap again — and that is how one instruction becomes two records.
 *
 * So this adds them up. If a timeout is raised somewhere and the total stops
 * fitting what a person will sit through, this fails instead of the owner
 * finding out.
 */

describe("the worst case an owner can be made to wait", () => {
  it("fits a read inside the turn budget", () => {
    expect(
      worstCaseReadMs,
      `a read can take ${worstCaseReadMs}ms, over the ${TURN_BUDGET_MS}ms budget`,
    ).toBeLessThanOrEqual(TURN_BUDGET_MS);
  });

  it("fits a write inside the turn budget", () => {
    expect(
      worstCaseWriteMs,
      `a write can take ${worstCaseWriteMs}ms, over the ${TURN_BUDGET_MS}ms budget`,
    ).toBeLessThanOrEqual(TURN_BUDGET_MS);
  });

  it("keeps the SILENT part short, which is what decides how broken it feels", () => {
    // While a form is visibly being filled in an owner will watch. While
    // nothing happens they will not — so this is the number that matters, and
    // it is held well under the whole-turn ceiling.
    expect(worstCaseSilentMs, `${worstCaseSilentMs}ms of silence is too long`).toBeLessThanOrEqual(10_000);
  });

  it("keeps the whole turn at something a person will sit through", () => {
    // It was forty seconds before anybody added it up.
    expect(TURN_BUDGET_MS).toBeLessThanOrEqual(20_000);
  });

  it("is most generous about confirming a save", () => {
    // Every other timeout costs a retry when it fires early; this one costs a
    // wrong answer about whether the owner's record exists.
    expect(VERIFY_MS).toBeGreaterThanOrEqual(CONTROL_MS);
  });

  it("keeps the verify wait at the figure a browser run actually needed", () => {
    // Not a round number picked for symmetry. VERIFY_MS was cut to 6s once to
    // balance this budget, and tests/e2e/assistant.spec.ts immediately went red
    // on a job that HAD saved: "I couldn't confirm whether that saved" next to
    // a correct record. At 8s it passes. Lowering this again is a one-line
    // change whose only witness is a 26-second browser run, so the measured
    // floor is written down here where it is cheap to check.
    expect(VERIFY_MS).toBeGreaterThanOrEqual(8_000);
  });
});

describe("the pieces are in a sensible order", () => {
  it("gives the summary less time than understanding", () => {
    // By the time it summarises, the page is already open and correct, so the
    // fallback ("I've opened it for you") is a real answer. Spending as long
    // again on a nicer sentence is not worth the owner's silence.
    expect(SUMMARY_MS).toBeLessThan(MODEL_MS);
  });

  it("settles a control in well under the time it waits for one", () => {
    expect(SETTLE_MS).toBeLessThan(CONTROL_MS);
  });

  it("lets transcription take longer than a turn, because nobody is waiting in silence", () => {
    // They have just finished speaking and know they did; the panel says so.
    expect(TRANSCRIBE_MS).toBeGreaterThan(TURN_BUDGET_MS);
  });

  it("caps a stuck recording well short of the 8 MB upload limit", () => {
    // 48 kbps mono is ~6 KB/s, so 30 s is ~180 KB — nowhere near the ceiling,
    // which is the point: the limit should never be what stops a recording.
    expect((MAX_RECORDING_MS / 1000) * 6_000).toBeLessThan(8 * 1024 * 1024);
  });
});

describe("no timeout is hidden outside the budget", () => {
  /** Files that make the owner wait. */
  const sources = [
    "src/lib/agent/groq.ts",
    "src/lib/agent/ui-controller.ts",
    "src/app/api/agent/listen/route.ts",
    "src/components/agent/use-speech.ts",
  ];

  it.each(sources)("%s declares no wait of its own", (path) => {
    const source = readFileSync(path, "utf8");
    // A bare multi-second literal assigned to something timeout-shaped is a
    // wait nobody added up. Kept as a grep rather than a convention, because a
    // convention is what slipped last time.
    const offenders = [...source.matchAll(/(?:TIMEOUT|WAIT|MS)\w*\s*=\s*(\d[\d_]{3,})/g)]
      .map((m) => m[0])
      .filter((m) => !/=\s*[1-9]\d{0,2}\b/.test(m));
    expect(offenders, `${path} sets a wait outside budget.ts: ${offenders.join(", ")}`).toEqual([]);
  });
});
