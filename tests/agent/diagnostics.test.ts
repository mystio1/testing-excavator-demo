import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { diagnosticsOpen, recentTurns, recordTurn, sweepDiagnostics } from "@/lib/agent/diagnostics";
import { cleanupTenant, createTenant, type TestTenant } from "../helpers/tenant";

/**
 * Diagnostics: what the owner said and what the model made of it.
 *
 * The property under test is not "does it log" — it is that it does NOT log
 * unless someone deliberately opened a window, that the window closes itself,
 * and that closing it takes what was collected with it. What gets recorded is
 * the owner's own words, which carry their customers' names and phone
 * numbers, so "off" has to mean off.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTenant("diag");
});
afterAll(async () => {
  await cleanupTenant(tenant.businessId);
});

beforeEach(async () => {
  await db.agentTurnLog.deleteMany({ where: { businessId: tenant.businessId } });
  await db.business.update({ where: { id: tenant.businessId }, data: { diagnosticsUntil: null } });
});

const openWindow = (hours = 1) =>
  db.business.update({
    where: { id: tenant.businessId },
    data: { diagnosticsUntil: new Date(Date.now() + hours * 60 * 60 * 1000) },
  });

const turn = () => ({
  businessId: tenant.businessId,
  userId: tenant.userId,
  taskId: "task-1",
  lang: "hi" as const,
  utterance: "Patil ko 2000 advance diya",
  reply: {
    kind: "action" as const,
    workflowId: "operator.transaction.add",
    fields: { operator: "Patil", amount: 2000 },
  },
});

describe("off by default", () => {
  it("records nothing for a business nobody opened a window on", async () => {
    expect(await diagnosticsOpen(tenant.businessId)).toBe(false);
    await recordTurn(turn());
    expect(await recentTurns(tenant.businessId)).toHaveLength(0);
  });

  it("records nothing once the window has passed", async () => {
    // A timestamp rather than a boolean, so this cannot be left on by
    // accident: it expires whether or not anyone remembers.
    await db.business.update({
      where: { id: tenant.businessId },
      data: { diagnosticsUntil: new Date(Date.now() - 1000) },
    });
    expect(await diagnosticsOpen(tenant.businessId)).toBe(false);
    await recordTurn(turn());
    expect(await recentTurns(tenant.businessId)).toHaveLength(0);
  });
});

describe("while a window is open", () => {
  it("keeps the sentence and what the model chose from it", async () => {
    await openWindow();
    await recordTurn(turn());

    const [row] = await recentTurns(tenant.businessId);
    expect(row).toBeTruthy();
    // The two things the audit trail cannot answer: what was heard, and what
    // the model decided from it.
    expect(row!.utterance).toBe("Patil ko 2000 advance diya");
    expect(row!.workflowId).toBe("operator.transaction.add");
    expect(row!.outcome).toBe("action");
    expect(JSON.stringify(row!.modelReply)).toContain("2000");
    expect(row!.lang).toBe("hi");
  });

  it("records a turn the model could not answer at all, with why", async () => {
    await openWindow();
    await recordTurn({ ...turn(), reply: null, errorKind: "rate_limited" });

    const [row] = await recentTurns(tenant.businessId);
    expect(row!.outcome).toBe("error:rate_limited");
    expect(row!.modelReply).toBeNull();
    // The sentence is still there — that is the half support needs when the
    // complaint is "it never answered me".
    expect(row!.utterance).toBeTruthy();
  });

  it("gives support the newest turns first, and not a thousand of them", async () => {
    await openWindow();
    for (let i = 0; i < 5; i += 1) {
      await recordTurn({ ...turn(), utterance: `sentence ${i}` });
    }
    const rows = await recentTurns(tenant.businessId, 3);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(rows[2]!.createdAt.getTime());
  });
});

describe("closing the window takes what it collected", () => {
  it("deletes the rows when diagnostics are switched off", async () => {
    // Otherwise "off" only ever meant "off from now on", and the owner's words
    // sit there anyway.
    await openWindow();
    await recordTurn(turn());
    expect(await recentTurns(tenant.businessId)).toHaveLength(1);

    await db.business.update({ where: { id: tenant.businessId }, data: { diagnosticsUntil: null } });
    await sweepDiagnostics();
    expect(await recentTurns(tenant.businessId)).toHaveLength(0);
  });

  it("deletes rows past the retention window even while it is still open", async () => {
    await openWindow();
    await recordTurn(turn());
    await db.agentTurnLog.updateMany({
      where: { businessId: tenant.businessId },
      data: { createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
    });

    await sweepDiagnostics();
    expect(await recentTurns(tenant.businessId)).toHaveLength(0);
  });

  it("leaves a fresh turn alone while the window is open", async () => {
    await openWindow();
    await recordTurn(turn());
    await sweepDiagnostics();
    expect(await recentTurns(tenant.businessId)).toHaveLength(1);
  });
});

describe("one business's diagnostics are not another's", () => {
  it("records only for the business the window was opened on", async () => {
    const other = await createTenant("diag-other");
    try {
      await openWindow();
      await recordTurn({ ...turn(), businessId: other.businessId, userId: other.userId });
      // The window belongs to `tenant`, not to `other`.
      expect(await recentTurns(other.businessId)).toHaveLength(0);
    } finally {
      await cleanupTenant(other.businessId);
    }
  });
});
