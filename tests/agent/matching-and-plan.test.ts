import { describe, expect, it } from "vitest";
import { describeAmbiguity, matchEntity, normalize, type Candidate } from "@/lib/agent/matching";
import { isExecutableOperation, planWorkflow } from "@/lib/agent/plan";

/**
 * The two pure halves of UI execution: deciding WHICH record was meant, and
 * deciding WHAT the browser is allowed to do about it. Both testable in node,
 * which is the point of keeping the DOM out of them.
 */

const machines: Candidate[] = [
  { value: "m1", label: "Komatsu PC200 (PC200-1)" },
  { value: "m2", label: "Komatsu PC200 (PC200-2)" },
  { value: "m3", label: "JCB 3DX (JCB-1)" },
];

const operators: Candidate[] = [
  { value: "o1", label: "Banda Patil" },
  { value: "o2", label: "Sagar Patil" },
  { value: "o3", label: "Ramesh Jadhav" },
];

describe("hearing a name as a record", () => {
  it("ignores spacing and punctuation", () => {
    expect(normalize("PC-200")).toBe("pc 200");
    expect(normalize("  Komatsu   PC200 !! ")).toBe("komatsu pc200");
  });

  it("keeps a Devanagari name whole", () => {
    // Vowel signs are combining marks, not letters. Treating them as
    // punctuation left "पाटील" as "प ट ल", so a name spoken or typed in
    // Marathi matched nothing at all.
    expect(normalize("पाटील")).toBe("पाटील");
    expect(normalize("देखने के लिए")).toBe("देखने के लिए");
    expect(matchEntity("पाटील", [{ value: "o9", label: "पाटील" }])).toMatchObject({
      kind: "unique",
      match: { value: "o9" },
    });
  });

  it("finds the one machine meant", () => {
    expect(matchEntity("JCB", machines)).toMatchObject({ kind: "unique", match: { value: "m3" } });
    expect(matchEntity("pc200 2", machines)).toMatchObject({ kind: "unique", match: { value: "m2" } });
  });

  it("drops the spoken filler around a name", () => {
    expect(matchEntity("machine number JCB", machines)).toMatchObject({ kind: "unique" });
    expect(matchEntity("mera JCB", machines)).toMatchObject({ kind: "unique", match: { value: "m3" } });
    expect(matchEntity("operator Ramesh", operators)).toMatchObject({ kind: "unique", match: { value: "o3" } });
  });

  it("ASKS when a surname could be two people", () => {
    const result = matchEntity("Patil", operators);
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") throw new Error("expected ambiguity");
    expect(describeAmbiguity(result.matches)).toEqual(["Banda Patil", "Sagar Patil"]);
  });

  it("takes the full name over the loose match when one is given", () => {
    expect(matchEntity("Banda Patil", operators)).toMatchObject({ kind: "unique", match: { value: "o1" } });
  });

  it("says nothing matched rather than offering the closest thing", () => {
    expect(matchEntity("Tractor", machines)).toEqual({ kind: "none" });
    expect(matchEntity("", machines)).toEqual({ kind: "none" });
  });

  it("is ambiguous, not arbitrary, when two machines share a model", () => {
    const result = matchEntity("Komatsu", machines);
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") throw new Error("expected ambiguity");
    expect(result.matches).toHaveLength(2);
  });
});

describe("planning what the browser may do", () => {
  const startWork = {
    machine: "Komatsu PC200 (PC200-2)",
    customer: "cus_1",
    site: "Wakad",
    startHourMeter: 1200,
  };

  it("produces the registered steps in order, carrying the collected values", () => {
    const plan = planWorkflow("work.start", startWork);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("expected a plan");

    expect(plan.operations[0]).toEqual({ action: "navigate", route: "/excavators" });
    expect(plan.operations).toContainEqual({ action: "fill", control: "siteName", value: "Wakad" });
    expect(plan.operations).toContainEqual({
      action: "pickFromList",
      control: "machine-card",
      query: "Komatsu PC200 (PC200-2)",
    });
    expect(plan.operations.at(-1)).toEqual({ action: "submit", control: "start-work-submit" });
    expect(plan.verify).toBe("active-work-card");
    // This dialog has no dedicated cancel button, and the registry says so
    // rather than naming a control that is not there.
    expect(plan.cancel).toBeNull();
  });

  it("refuses a workflow the app does not have", () => {
    expect(planWorkflow("trip.create", {})).toMatchObject({ ok: false, reason: "UNKNOWN_WORKFLOW" });
  });

  it("refuses to run with a required value missing rather than submitting a blank", () => {
    const withoutSite = { ...startWork, site: "" };
    expect(planWorkflow("work.start", withoutSite)).toMatchObject({
      ok: false,
      reason: "MISSING_VALUE",
      detail: "site",
    });
  });

  it("skips an absent optional field so the form keeps its own default", () => {
    // No start date was said, so the box is left alone rather than blanked —
    // the form already defaults it to today.
    const plan = planWorkflow("work.start", startWork);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.operations.some((o) => "control" in o && o.control === "startDate")).toBe(false);
  });

  it("fills an optional field when it was given", () => {
    const plan = planWorkflow("work.start", { ...startWork, startDate: "2026-10-20" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.operations).toContainEqual({
      action: "fill",
      control: "startDate",
      value: "2026-10-20",
    });
  });

  it("plans a reading, diesel and all", () => {
    const plan = planWorkflow("reading.add", {
      machine: "JCB",
      date: "2026-10-20",
      endHourMeter: 1208,
      dieselLiters: 40,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.operations).toContainEqual({ action: "fill", control: "dieselLiters", value: "40" });
    expect(plan.verify).toBe("readings-list");
  });
});

describe("the browser re-checks what it is handed", () => {
  it("accepts the shapes it knows", () => {
    expect(isExecutableOperation({ action: "navigate", route: "/excavators" })).toBe(true);
    expect(isExecutableOperation({ action: "fill", control: "siteName", value: "Wakad" })).toBe(true);
  });

  it("rejects a verb that is not in the set, however it is dressed up", () => {
    expect(isExecutableOperation({ action: "runScript", control: "x" })).toBe(false);
    expect(isExecutableOperation({ action: "eval", control: "x" })).toBe(false);
    expect(isExecutableOperation({ action: "navigate" })).toBe(false);
    expect(isExecutableOperation(null)).toBe(false);
    expect(isExecutableOperation("click")).toBe(false);
  });
});
