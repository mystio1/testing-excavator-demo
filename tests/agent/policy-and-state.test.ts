import { describe, expect, it } from "vitest";
import { agentResponseSchema } from "@/lib/agent/types";
import { capabilityCatalogue, missingFields, nextQuestion, pickKnownFields, resolve } from "@/lib/agent/resolver";
import { authorize, confirmationFor, ownsTask, type Actor } from "@/lib/agent/policy";
import { canTransition, confirm, newTask, setFields, transition, TaskTransitionError } from "@/lib/agent/task-state";

/**
 * The agent's safety properties, tested where they are actually enforced: in
 * deterministic code the model cannot influence. Nothing here calls Grok.
 */

const owner: Actor = { kind: "owner", businessId: "b1", userId: "u1" };
const operator: Actor = { kind: "operator", businessId: "b1", userId: "op1" };

const task = (over: Partial<ReturnType<typeof newTask>> = {}) => ({
  ...newTask({ id: "t1", businessId: "b1", userId: "u1", lang: "en" }),
  ...over,
});

/** A complete, valid "start a job" — the happy path other tests break. */
const startWorkFields = {
  machine: "exc_1",
  customer: "cus_1",
  site: "Wakad",
  startHourMeter: 1200,
};

describe("the registry is the allowlist", () => {
  it("refuses a workflow the app does not have", () => {
    expect(resolve("trip.create")).toBeNull();
    const decision = authorize(task(), owner, "trip.create");
    expect(decision).toMatchObject({ allow: false, reason: "UNKNOWN_WORKFLOW" });
  });

  it("refuses an invented one however plausible it sounds", () => {
    expect(authorize(task(), owner, "expense.create")).toMatchObject({ reason: "UNKNOWN_WORKFLOW" });
    expect(authorize(task(), owner, "machine.delete_all")).toMatchObject({ reason: "UNKNOWN_WORKFLOW" });
  });

  it("gives the model capabilities and field names — never routes or control ids", () => {
    const catalogue = capabilityCatalogue();
    expect(catalogue.length).toBeGreaterThan(0);
    for (const entry of catalogue) {
      expect(Object.keys(entry).sort()).toEqual(["effect", "fields", "id", "summary"]);
      expect(entry.fields).not.toContain("/");
      expect(entry.fields).not.toContain("-card");
      expect(entry.fields).not.toContain("-submit");
    }
    // Field names are what the model must echo back; controls are not.
    expect(catalogue.find((c) => c.id === "work.start")!.fields).toContain("startHourMeter");
  });

  it("drops proposed fields the workflow never declared", () => {
    const workflow = resolve("work.start")!;
    const kept = pickKnownFields(workflow, { site: "Wakad", isAdmin: "true", amount: 99 });
    expect(kept).toEqual({ site: "Wakad" });
  });
});

describe("model output is parsed, not trusted", () => {
  it("accepts the three shapes it is allowed to return", () => {
    expect(agentResponseSchema.safeParse({ kind: "reply", message: "ok" }).success).toBe(true);
    expect(agentResponseSchema.safeParse({ kind: "clarify", question: "Which operator?" }).success).toBe(true);
    expect(
      agentResponseSchema.safeParse({ kind: "action", workflowId: "work.start", fields: {} }).success,
    ).toBe(true);
  });

  it("rejects anything else, including a self-granted approval", () => {
    expect(
      agentResponseSchema.safeParse({ kind: "action", workflowId: "work.start", fields: {}, confirmed: true })
        .success,
    ).toBe(false);
    expect(agentResponseSchema.safeParse({ kind: "runScript", code: "alert(1)" }).success).toBe(false);
    expect(agentResponseSchema.safeParse({ kind: "action" }).success).toBe(false);
  });
});

describe("permissions survive the assistant", () => {
  it("lets an operator read but never write", () => {
    const reading = task({ fields: { machine: "exc_1" } });
    expect(authorize(reading, operator, "machine.status.view")).toMatchObject({ allow: true });

    const writing = task({ fields: startWorkFields });
    expect(authorize(writing, operator, "work.start")).toMatchObject({
      allow: false,
      reason: "NOT_PERMITTED",
    });
  });

  it("binds a task to the user it was opened for", () => {
    const mine = task();
    expect(ownsTask(mine, owner)).toBe(true);
    expect(ownsTask(mine, { ...owner, userId: "someone-else" })).toBe(false);
    expect(ownsTask(mine, { ...owner, businessId: "another-tenant" })).toBe(false);
  });
});

describe("confirmation covers the exact values", () => {
  it("asks before any write, and never for a read", () => {
    expect(authorize(task({ fields: startWorkFields }), owner, "work.start")).toMatchObject({
      allow: false,
      reason: "NOT_CONFIRMED",
    });
    expect(authorize(task({ fields: { machine: "exc_1" } }), owner, "machine.status.view")).toMatchObject({
      allow: true,
    });
  });

  it("passes once confirmed", () => {
    const ready = confirm(task({ workflowId: "work.start", fields: startWorkFields }));
    expect(authorize(ready, owner, "work.start")).toMatchObject({ allow: true });
  });

  it('goes stale when a value changes — "Hinjawadi, not Wakad" is a new approval', () => {
    const confirmed = confirm(task({ workflowId: "work.start", fields: startWorkFields }));
    expect(authorize(confirmed, owner, "work.start")).toMatchObject({ allow: true });

    const corrected = setFields(confirmed, { site: "Hinjawadi" });
    expect(corrected.confirmedFingerprint).toBeNull();
    expect(authorize(corrected, owner, "work.start")).toMatchObject({
      allow: false,
      reason: "NOT_CONFIRMED",
    });
  });

  it("will not accept an approval minted for different values", () => {
    const stale = task({
      workflowId: "work.start",
      fields: startWorkFields,
      confirmedFingerprint: confirmationFor("work.start", { ...startWorkFields, site: "Hinjawadi" }),
    });
    expect(authorize(stale, owner, "work.start")).toMatchObject({ reason: "CONFIRMATION_STALE" });
  });

  it("is per workflow, so an approval cannot be carried to another action", () => {
    const fields = { amount: 1200 };
    expect(confirmationFor("operator.transaction.add", fields)).not.toBe(confirmationFor("work.start", fields));
  });
});

describe("missing details are asked for, not invented", () => {
  it("names what is still needed, in registry order", () => {
    const workflow = resolve("work.start")!;
    expect(missingFields(workflow, {}).map((f) => f.name)).toEqual([
      "machine",
      "customer",
      "site",
      "startHourMeter",
    ]);
    // startDate is optional — the form defaults it.
    expect(missingFields(workflow, startWorkFields)).toHaveLength(0);
  });

  it("asks in the user's own language", () => {
    const workflow = resolve("work.start")!;
    expect(nextQuestion(workflow, {}, "en")).toBe("Which machine?");
    expect(nextQuestion(workflow, {}, "hi")).toBe("कौन सी मशीन?");
    expect(nextQuestion(workflow, { machine: "m1" }, "mr")).toBe("कोणता ग्राहक?");
  });
});

describe("a task cannot claim success it did not earn", () => {
  it("reaches SUCCEEDED only by way of VERIFYING", () => {
    expect(canTransition("EXECUTING", "SUCCEEDED")).toBe(false);
    expect(canTransition("READY_FOR_CONFIRMATION", "SUCCEEDED")).toBe(false);
    expect(canTransition("VERIFYING", "SUCCEEDED")).toBe(true);
  });

  it("throws rather than silently allowing an impossible jump", () => {
    const executing = transition(
      transition(
        transition(transition(task(), "UNDERSTANDING"), "RESOLVING_WORKFLOW"),
        "READY_FOR_CONFIRMATION",
      ),
      "EXECUTING",
    );
    expect(() => transition(executing, "SUCCEEDED")).toThrow(TaskTransitionError);
    expect(transition(executing, "VERIFYING").state).toBe("VERIFYING");
  });

  it("cannot be cancelled once submitted — the write may already have happened", () => {
    expect(canTransition("EXECUTING", "CANCELLED")).toBe(false);
    expect(canTransition("READY_FOR_CONFIRMATION", "CANCELLED")).toBe(true);
  });

  it("sends an unknown outcome to recovery rather than round again", () => {
    expect(canTransition("NEEDS_RECOVERY", "EXECUTING")).toBe(false);
    expect(canTransition("NEEDS_RECOVERY", "VERIFYING")).toBe(true);
  });

  it("lets a correction go back for details instead of forward", () => {
    expect(canTransition("READY_FOR_CONFIRMATION", "COLLECTING_DETAILS")).toBe(true);
  });
});
