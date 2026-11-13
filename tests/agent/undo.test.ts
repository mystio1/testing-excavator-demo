import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetTasks,
  handleConfirm,
  handleMessage,
  handleResult,
  handleUndo,
  type AskFn,
} from "@/lib/agent/orchestrator";
import type { Actor } from "@/lib/agent/policy";
import type { AgentResponse } from "@/lib/agent/types";

/**
 * "That was wrong."
 *
 * The thing being tested is as much what undo REFUSES to do as what it does.
 * The assistant drives the app's own forms and never calls its API, so it
 * never learns the id of the row a save created — the only way to delete "the
 * one I just added" would be to assume the newest row in a list is it. On an
 * operator's money that guess is worse than no undo at all, and silently
 * removing the wrong record is precisely what someone who cannot read the
 * screen could not catch.
 *
 * So it opens the page, names the record by the values that were approved, and
 * leaves the removing to the owner.
 */

const owner: Actor = { kind: "owner", businessId: "b1", userId: "u1" };
const always = (response: AgentResponse): AskFn => async () => response;

const payPatil: AgentResponse = {
  kind: "action",
  workflowId: "operator.transaction.add",
  fields: { operator: "Patil", amount: 2000, category: "cat_1", date: "2026-10-23" },
};

const startWork: AgentResponse = {
  kind: "action",
  workflowId: "work.start",
  fields: { machine: "Komatsu PC200", customer: "cus_1", site: "Wakad", startHourMeter: 1200 },
};

beforeEach(__resetTasks);

/** Drive a write all the way to a confirmed save. */
async function saveSomething(response: AgentResponse) {
  const proposed = await handleMessage({ text: "do it", lang: "en" }, owner, { ask: always(response) });
  await handleConfirm(proposed.taskId, owner);
  await handleResult(proposed.taskId, owner, { verified: true });
  return proposed.taskId;
}

describe("after something was saved", () => {
  it("opens where the record is and names it by what was approved", async () => {
    await saveSomething(payPatil);
    const undo = await handleUndo({ lang: "en" }, owner);

    expect(undo.plan).toBeTruthy();
    // The owner is told which entry, in the values they approved.
    expect(undo.say).toContain("2000");
    expect(undo.say).toContain("Patil");
    expect(undo.say).toMatch(/remove it/i);
  });

  it("does not claim to have removed anything", async () => {
    // It cannot, and saying so would be the one unrecoverable lie here.
    await saveSomething(payPatil);
    const undo = await handleUndo({ lang: "en" }, owner);
    expect(undo.say).not.toMatch(/removed|deleted|undone|cancelled/i);
  });

  it("fills nothing and submits nothing — it only navigates", async () => {
    // A plan that touched the form could re-save the very thing being undone.
    await saveSomething(payPatil);
    const undo = await handleUndo({ lang: "en" }, owner);

    const actions = undo.plan!.operations.map((o) => o.action);
    expect(actions).not.toContain("fill");
    expect(actions).not.toContain("select");
    expect(actions).not.toContain("submit");
    expect(actions).toContain("navigate");
  });

  it("does not re-open the dialog that did the saving", async () => {
    await saveSomething(payPatil);
    const undo = await handleUndo({ lang: "en" }, owner);
    const clicked = undo.plan!.operations.flatMap((o) => ("control" in o ? [o.control] : []));
    // openWith for this workflow. Opening it again would cover the record the
    // owner is being shown.
    expect(clicked).not.toContain("add-transaction-trigger");
  });

  it("takes the owner to the most recent write when there were several", async () => {
    await saveSomething(startWork);
    await saveSomething(payPatil);

    const undo = await handleUndo({ lang: "en" }, owner);
    // "That was wrong" means the last thing, not the first.
    expect(undo.say).toContain("2000");
    expect(undo.say).not.toContain("Wakad");
  });

  it("answers in the owner's own language", async () => {
    await saveSomething(payPatil);
    const undo = await handleUndo({ lang: "mr" }, owner);
    expect(undo.say).toMatch(/उघडली|काढू/);
  });
});

describe("when there is nothing to take back", () => {
  it("says so rather than opening something at random", async () => {
    const undo = await handleUndo({ lang: "en" }, owner);
    expect(undo.plan).toBeUndefined();
    expect(undo.say).toMatch(/nothing/i);
  });

  it("ignores a read, which changed nothing", async () => {
    const asked = await handleMessage({ text: "dashboard", lang: "en" }, owner, {
      ask: always({ kind: "action", workflowId: "business.dashboard.view", fields: {} }),
    });
    await handleResult(asked.taskId, owner, { verified: true, screenText: "Revenue 100" });

    const undo = await handleUndo({ lang: "en" }, owner);
    expect(undo.plan).toBeUndefined();
    expect(undo.say).toMatch(/nothing/i);
  });

  it("ignores a write that was never approved", async () => {
    // Proposed and abandoned. There is nothing saved to go back to.
    await handleMessage({ text: "pay Patil", lang: "en" }, owner, { ask: always(payPatil) });
    const undo = await handleUndo({ lang: "en" }, owner);
    expect(undo.plan).toBeUndefined();
  });

  it("ignores a write the screen never confirmed", async () => {
    const proposed = await handleMessage({ text: "pay Patil", lang: "en" }, owner, { ask: always(payPatil) });
    await handleConfirm(proposed.taskId, owner);
    await handleResult(proposed.taskId, owner, { verified: false });

    // It may or may not have saved. Taking the owner to "the record" would be
    // asserting it exists.
    const undo = await handleUndo({ lang: "en" }, owner);
    expect(undo.plan).toBeUndefined();
  });
});

describe("one owner's last write is not another's", () => {
  it("never reaches another user's record", async () => {
    await saveSomething(payPatil);
    const someoneElse: Actor = { kind: "owner", businessId: "b1", userId: "another-user" };
    const undo = await handleUndo({ lang: "en" }, someoneElse);
    expect(undo.plan).toBeUndefined();
  });

  it("never reaches another business's record", async () => {
    await saveSomething(payPatil);
    const otherBusiness: Actor = { kind: "owner", businessId: "b2", userId: "u1" };
    const undo = await handleUndo({ lang: "en" }, otherBusiness);
    expect(undo.plan).toBeUndefined();
  });
});
