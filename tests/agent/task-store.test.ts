import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { dbTaskStore, memoryTaskStore } from "@/lib/agent/task-store";
import { newTask, setFields, transition } from "@/lib/agent/task-state";
import { cleanupTenant, createTenant, type TestTenant } from "../helpers/tenant";
import type { AgentTask } from "@/lib/agent/types";

/**
 * A half-finished turn, surviving the thing that used to lose it.
 *
 * The pending task lived in a Map in one process. Render restarts on every
 * deploy and spins down on the free tier, and more than one instance can serve
 * the same owner — so the owner tapped "Yes, save it" and was told "That
 * request has expired", on the one action that cannot happen without their
 * approval. A fresh store standing in for a fresh process is the whole test.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTenant("taskstore");
});
afterAll(async () => {
  await cleanupTenant(tenant.businessId);
});

const scope = () => ({ businessId: tenant.businessId, userId: tenant.userId });

const pending = (id: string): AgentTask => {
  const fresh = newTask({ id, businessId: tenant.businessId, userId: tenant.userId, lang: "hi" });
  const asked = setFields(
    { ...transition(transition(fresh, "UNDERSTANDING"), "RESOLVING_WORKFLOW"), workflowId: "work.start", question: "kaam shuru karo" },
    { machine: "Komatsu PC200", site: "Wakad", startHourMeter: 1200 },
  );
  return transition(transition(asked, "COLLECTING_DETAILS"), "READY_FOR_CONFIRMATION");
};

beforeEach(async () => {
  await db.agentTask.deleteMany({ where: { businessId: tenant.businessId } });
});

describe("a pending turn in the database", () => {
  it("is still there for a brand new store, which is what a restart looks like", async () => {
    const id = `t-${Date.now()}-a`;
    await dbTaskStore().save(pending(id));

    // A different store instance: nothing is shared in memory between them.
    const afterRestart = await dbTaskStore().get(id, scope());

    expect(afterRestart).not.toBeNull();
    expect(afterRestart!.state).toBe("READY_FOR_CONFIRMATION");
    expect(afterRestart!.workflowId).toBe("work.start");
    // The values the owner was shown, intact — a yes has to apply to these.
    expect(afterRestart!.fields).toEqual({ machine: "Komatsu PC200", site: "Wakad", startHourMeter: 1200 });
    expect(afterRestart!.question).toBe("kaam shuru karo");
    expect(afterRestart!.lang).toBe("hi");
  });

  it("keeps the approval fingerprint, so an old yes cannot cover new values", async () => {
    const id = `t-${Date.now()}-b`;
    const approved = { ...pending(id), confirmedFingerprint: "fp-abc" };
    await dbTaskStore().save(approved);
    expect((await dbTaskStore().get(id, scope()))!.confirmedFingerprint).toBe("fp-abc");
  });

  it("will not hand a task to another user, however they got the id", async () => {
    const id = `t-${Date.now()}-c`;
    await dbTaskStore().save(pending(id));
    const intruder = { businessId: tenant.businessId, userId: "someone-else" };
    expect(await dbTaskStore().get(id, intruder)).toBeNull();
  });

  it("will not hand a task to another business", async () => {
    const id = `t-${Date.now()}-d`;
    await dbTaskStore().save(pending(id));
    expect(await dbTaskStore().get(id, { businessId: "other-business", userId: tenant.userId })).toBeNull();
  });

  it("overwrites in place as the turn moves on", async () => {
    const id = `t-${Date.now()}-e`;
    const store = dbTaskStore();
    const task = pending(id);
    await store.save(task);
    await store.save(transition(task, "EXECUTING"));

    expect((await store.get(id, scope()))!.state).toBe("EXECUTING");
    expect(await db.agentTask.count({ where: { id } })).toBe(1);
  });

  it("sweeps away a turn nobody came back to", async () => {
    const id = `t-${Date.now()}-f`;
    const store = dbTaskStore();
    await store.save({ ...pending(id), updatedAt: new Date(Date.now() - 60 * 60 * 1000) });

    await store.sweep(new Date(Date.now() - 30 * 60 * 1000));
    expect(await store.get(id, scope())).toBeNull();
  });

  it("leaves a turn that is still warm alone", async () => {
    const id = `t-${Date.now()}-g`;
    const store = dbTaskStore();
    await store.save(pending(id));
    await store.sweep(new Date(Date.now() - 30 * 60 * 1000));
    expect(await store.get(id, scope())).not.toBeNull();
  });

  it("treats a row it cannot read as gone rather than acting on half of it", async () => {
    // A row from a newer build, or one edited by hand. Half-understanding a
    // pending write is worse than asking again.
    const id = `t-${Date.now()}-h`;
    await dbTaskStore().save(pending(id));
    await db.agentTask.update({ where: { id }, data: { state: "NOT_A_REAL_STATE" } });
    expect(await dbTaskStore().get(id, scope())).toBeNull();
  });

  it("treats a field that is not a plain value as unreadable too", async () => {
    const id = `t-${Date.now()}-i`;
    await dbTaskStore().save(pending(id));
    await db.agentTask.update({ where: { id }, data: { fields: { machine: { nested: true } } } });
    expect(await dbTaskStore().get(id, scope())).toBeNull();
  });
});

describe("the in-memory store, which is what the tests run on", () => {
  it("behaves the same way about ownership", async () => {
    const store = memoryTaskStore();
    const id = "mem-1";
    await store.save(pending(id));
    expect(await store.get(id, scope())).not.toBeNull();
    expect(await store.get(id, { businessId: tenant.businessId, userId: "nope" })).toBeNull();
  });

  it("sweeps on the same rule", async () => {
    const store = memoryTaskStore();
    await store.save({ ...pending("mem-2"), updatedAt: new Date(Date.now() - 60 * 60 * 1000) });
    await store.sweep(new Date(Date.now() - 30 * 60 * 1000));
    expect(await store.get("mem-2", scope())).toBeNull();
  });
});
