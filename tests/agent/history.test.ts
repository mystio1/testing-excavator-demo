import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAssistantActions } from "@/lib/services/assistantHistory";
import { agentTrail } from "@/lib/agent/trail";
import { cleanupTenant, createTenant, type TestTenant } from "../helpers/tenant";

/**
 * What the assistant did, as the owner reads it.
 *
 * The rows were always written; nothing surfaced them, which meant the owner
 * had no way to check up on something acting on their behalf. For a person who
 * cannot read the screen well enough to catch a mistake as it happens, looking
 * afterwards is the whole safety net — so the thing that matters here is that
 * one request they made shows up as ONE line, with the right ending.
 */

let tenant: TestTenant;
let other: TestTenant;

beforeAll(async () => {
  tenant = await createTenant("history");
  other = await createTenant("history-other");
});
afterAll(async () => {
  await cleanupTenant(tenant.businessId);
  await cleanupTenant(other.businessId);
});

const record = (t: TestTenant) => agentTrail(t.businessId, t.actor);

/** AuditLog is append-only, so each case uses its own task ids rather than
 * clearing anything. */
const taskId = (suffix: string) => `hist-${Date.now()}-${suffix}`;

describe("one request, one line", () => {
  it("folds an approval and its outcome together", async () => {
    const id = taskId("a");
    const write = record(tenant);
    await write({
      taskId: id,
      workflowId: "operator.transaction.add",
      effect: "SENSITIVE",
      fields: { operator: "Patil", amount: 2000 },
      phase: "approved",
    });
    await write({
      taskId: id,
      workflowId: "operator.transaction.add",
      effect: "SENSITIVE",
      fields: { operator: "Patil", amount: 2000 },
      phase: "executed",
    });

    const actions = await listAssistantActions(tenant.businessId);
    const mine = actions.filter((a) => a.taskId === id);
    // Two rows about one thing the owner asked for.
    expect(mine).toHaveLength(1);
    expect(mine[0]!.outcome).toBe("saved");
    expect(mine[0]!.workflowId).toBe("operator.transaction.add");
    // The figures as they were approved — which is the point of showing it.
    expect(mine[0]!.fields).toMatchObject({ operator: "Patil", amount: 2000 });
  });

  it("shows a doubtful one as doubtful, with what the screen said", async () => {
    const id = taskId("b");
    const write = record(tenant);
    await write({
      taskId: id,
      workflowId: "work.start",
      effect: "WRITE",
      fields: { machine: "Komatsu PC200", site: "Wakad" },
      phase: "approved",
    });
    await write({
      taskId: id,
      workflowId: "work.start",
      effect: "WRITE",
      fields: { machine: "Komatsu PC200", site: "Wakad" },
      phase: "unverified",
      detail: "The save button never appeared.",
    });

    const [action] = (await listAssistantActions(tenant.businessId)).filter((a) => a.taskId === id);
    expect(action!.outcome).toBe("unconfirmed");
    expect(action!.detail).toBe("The save button never appeared.");
    // Still carries the values, so the owner knows what to go and check.
    expect(action!.fields).toMatchObject({ site: "Wakad" });
  });

  it("shows an approval with no result as exactly that", async () => {
    // The browser never reported back — a lost connection mid-turn. Saying
    // "saved" would be a guess and "failed" would be a different guess.
    const id = taskId("c");
    await record(tenant)({
      taskId: id,
      workflowId: "reading.add",
      effect: "WRITE",
      fields: { machine: "JCB", endHourMeter: 1208 },
      phase: "approved",
    });

    const [action] = (await listAssistantActions(tenant.businessId)).filter((a) => a.taskId === id);
    expect(action!.outcome).toBe("pending");
  });

  it("puts the newest first", async () => {
    const write = record(tenant);
    const first = taskId("d1");
    const second = taskId("d2");
    await write({ taskId: first, workflowId: "work.stop", effect: "WRITE", fields: {}, phase: "executed" });
    await write({ taskId: second, workflowId: "customer.create", effect: "WRITE", fields: {}, phase: "executed" });

    const actions = await listAssistantActions(tenant.businessId);
    const positions = [actions.findIndex((a) => a.taskId === second), actions.findIndex((a) => a.taskId === first)];
    expect(positions[0]).toBeLessThan(positions[1]);
  });
});

describe("reads leave no trail, so none appears here", () => {
  it("lists nothing for a question", async () => {
    const id = taskId("e");
    // trail() refuses a READ; this goes through the same recorder the
    // orchestrator uses, so the filtering is the real one.
    await record(tenant)({
      taskId: id,
      workflowId: "machine.list",
      effect: "READ",
      fields: {},
      phase: "executed",
    });
    const actions = await listAssistantActions(tenant.businessId);
    expect(actions.find((a) => a.taskId === id)).toBeUndefined();
  });
});

describe("one business's history is not another's", () => {
  it("never shows another tenant's actions", async () => {
    const id = taskId("f");
    await record(other)({
      taskId: id,
      workflowId: "work.start",
      effect: "WRITE",
      fields: { machine: "Someone Else's Machine" },
      phase: "executed",
    });

    const mine = await listAssistantActions(tenant.businessId, 100);
    expect(mine.find((a) => a.taskId === id)).toBeUndefined();
    expect(JSON.stringify(mine)).not.toContain("Someone Else's Machine");
  });
});

describe("the limit", () => {
  it("is bounded however large a number is asked for", async () => {
    const actions = await listAssistantActions(tenant.businessId, 100_000);
    expect(actions.length).toBeLessThanOrEqual(100);
  });
});

describe("the page the assistant opens", () => {
  it("is annotated with the control the workflow verifies", async () => {
    // The capability is only honest if the control it waits for exists.
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/app/(app)/settings/assistant/page.tsx", "utf8");
    expect(page).toContain('data-agent-id="assistant-history"');
  });

  it("is reachable without knowing the words to ask", async () => {
    const settings = (await import("node:fs")).readFileSync("src/app/(app)/settings/page.tsx", "utf8");
    expect(settings).toContain("/settings/assistant");
  });
});

/** Guard against the history being quietly gated on the switch. */
describe("history survives the assistant being switched off", () => {
  it("is not behind assertAssistantAvailable", async () => {
    const route = (await import("node:fs")).readFileSync("src/app/api/agent/history/route.ts", "utf8");
    // If the assistant was just switched off because it did something wrong,
    // that is exactly when the owner needs to see what it did.
    expect(route).not.toContain("assertAssistantAvailable");
  });
});
