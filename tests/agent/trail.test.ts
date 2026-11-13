import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetTasks,
  handleConfirm,
  handleMessage,
  handleResult,
  type AskFn,
} from "@/lib/agent/orchestrator";
import type { Actor } from "@/lib/agent/policy";
import type { AgentTrailEntry } from "@/lib/agent/trail";
import type { AgentResponse } from "@/lib/agent/types";

/**
 * What the assistant leaves behind.
 *
 * The assistant drives the real forms, so the row that lands looks exactly
 * like one the owner typed. These are the entries that let someone tell the
 * difference a month later — and the cases where there must be no entry at
 * all, because nothing was approved.
 */

const owner: Actor = { kind: "owner", businessId: "b1", userId: "u1" };
const always = (response: AgentResponse): AskFn => async () => response;

const startWork: AgentResponse = {
  kind: "action",
  workflowId: "work.start",
  fields: { machine: "Komatsu PC200", customer: "cus_1", site: "Wakad", startHourMeter: 1200 },
};

const payOperator: AgentResponse = {
  kind: "action",
  workflowId: "operator.transaction.add",
  fields: { operator: "Patil", amount: 2000, category: "cat_1", date: "2026-10-23" },
};

let entries: AgentTrailEntry[];
let record: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetTasks();
  entries = [];
  record = vi.fn(async (entry: AgentTrailEntry) => {
    entries.push(entry);
  });
});

const send = (text: string, ask: AskFn) =>
  handleMessage({ text, lang: "en", taskId: undefined }, owner, { ask, record });

describe("the assistant's own trail", () => {
  it("records the approval before the browser is handed anything", async () => {
    const proposed = await send("Komatsu ka kaam shuru karo, Wakad", always(startWork));
    // Nothing yet: it has only been proposed.
    expect(entries).toHaveLength(0);

    await handleConfirm(proposed.taskId, owner, { record });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      taskId: proposed.taskId,
      workflowId: "work.start",
      effect: "WRITE",
      phase: "approved",
    });
    // The values as they were put in front of the owner, which is the whole
    // point of recording at approval rather than afterwards.
    expect(entries[0]!.fields).toMatchObject({ site: "Wakad", startHourMeter: 1200 });
  });

  it("records the outcome the screen reported, under the same task", async () => {
    const proposed = await send("start work", always(startWork));
    await handleConfirm(proposed.taskId, owner, { record });
    await handleResult(proposed.taskId, owner, { verified: true }, { record });

    expect(entries.map((e) => e.phase)).toEqual(["approved", "executed"]);
    expect(new Set(entries.map((e) => e.taskId)).size).toBe(1);
  });

  it("marks an unconfirmed outcome as in doubt, with what the screen said", async () => {
    const proposed = await send("start work", always(startWork));
    await handleConfirm(proposed.taskId, owner, { record });
    await handleResult(
      proposed.taskId,
      owner,
      { verified: false, error: "That button is not available yet." },
      { record },
    );

    const last = entries.at(-1)!;
    expect(last.phase).toBe("unverified");
    expect(last.detail).toBe("That button is not available yet.");
  });

  it("writes nothing when the owner was only asked", async () => {
    // Proposed, never approved. A trail entry here would read as consent.
    await send("Komatsu ka kaam shuru karo, Wakad", always(startWork));
    expect(record).not.toHaveBeenCalled();
  });

  it("writes nothing when a detail is still missing", async () => {
    await send(
      "Komatsu ka kaam shuru karo",
      always({ kind: "action", workflowId: "work.start", fields: { machine: "Komatsu PC200" } }),
    );
    expect(record).not.toHaveBeenCalled();
  });

  it("writes nothing for a question", async () => {
    // Reads would bury the entries that matter, and nothing changed.
    const asked = await send(
      "kitna kaam hua?",
      always({ kind: "action", workflowId: "business.dashboard.view", fields: {} }),
    );
    await handleResult(asked.taskId, owner, { verified: true, screenText: "Revenue 100" }, { record });
    expect(record).not.toHaveBeenCalled();
  });

  it("writes nothing when someone else's task id is replayed", async () => {
    const proposed = await send("start work", always(startWork));
    const intruder: Actor = { kind: "owner", businessId: "b1", userId: "someone-else" };
    await handleConfirm(proposed.taskId, intruder, { record });
    expect(record).not.toHaveBeenCalled();
  });

  it("records money against a person as the sensitive thing it is", async () => {
    const proposed = await send("Patil ko 2000 advance diya", always(payOperator));
    await handleConfirm(proposed.taskId, owner, { record });
    expect(entries[0]).toMatchObject({
      workflowId: "operator.transaction.add",
      effect: "SENSITIVE",
      phase: "approved",
    });
    expect(entries[0]!.fields).toMatchObject({ amount: 2000 });
  });

  it("still answers the owner when the trail cannot be written", async () => {
    // The trail is a record of the owner's work, never a gate on it.
    const failing = vi.fn(async () => {
      throw new Error("audit table unreachable");
    });
    const proposed = await send("start work", always(startWork));
    const approved = await handleConfirm(proposed.taskId, owner, { record: failing });
    expect(approved.state).toBe("EXECUTING");
    expect(approved.plan).toBeDefined();
  });

  it("works with no recorder at all, as the tests and the CLI do", async () => {
    const proposed = await handleMessage({ text: "start work", lang: "en" }, owner, {
      ask: always(startWork),
    });
    const approved = await handleConfirm(proposed.taskId, owner);
    expect(approved.plan).toBeDefined();
  });
});
