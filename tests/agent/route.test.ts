import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { cleanupTenant, createTenant, fakeRequest, type TestTenant } from "../helpers/tenant";
import type { AgentResponse } from "@/lib/agent/types";

/**
 * /api/agent end to end: the real route, the real orchestrator, the real
 * policy, the real rate limiter and a real database. Only two things are
 * replaced — the session lookup, and the model.
 *
 * The unit tests prove the turn loop in isolation. This proves the wiring: that
 * an approval actually reaches the AuditLog table, that an unauthenticated
 * caller gets nothing, and that one owner cannot drive another's task. Those
 * are the parts a mocked recorder cannot tell us anything about.
 */

const auth = vi.hoisted(() => ({
  current: null as null | { businessId: string; userId: string; ownerName: string },
}));

vi.mock("@/lib/api-auth", () => ({
  requireBusinessApi: async () => {
    const s = auth.current;
    if (!s) {
      const { errorResponse } = await import("@/lib/api-error");
      return { session: null, error: errorResponse("UNAUTHORIZED", "Please log in again.") };
    }
    return {
      session: { ...s, businessFrozen: false, supportSessionId: null },
      actor: { type: "OWNER", id: s.userId, name: s.ownerName },
      error: null,
    };
  },
}));

/** The model, stubbed. What it says is one input to the turn; the point here
 * is everything that happens around it. */
const model = vi.hoisted(() => ({ reply: null as AgentResponse | null }));

vi.mock("@/lib/agent/groq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/groq")>();
  return {
    ...actual,
    askGroq: async () => {
      if (!model.reply) throw new actual.GroqError("no stub set", "http");
      return model.reply;
    },
    answerFromScreen: async () => "Is mahine 126 ghante kaam hua.",
  };
});

/**
 * A small ask limit, set before the route is imported because QUOTAS reads the
 * environment once at module load.
 *
 * The default is 20 a minute, and the loop below used to fire 22 requests
 * against it. Each request here is a real route call against a real database,
 * so 22 of them take 20-30 seconds — and the limiter is a sliding-window
 * COUNTER, where the effective count is this window's plus the previous
 * window's decayed by how far into the window we are. Spread 22 requests
 * across a window boundary and the effective count can legitimately never
 * reach 20, so nothing is refused and the test fails having found no fault at
 * all. It passed alone and failed in the full suite, which is the worst kind
 * of test.
 *
 * Seven requests at a limit of five finish in a few seconds, nowhere near a
 * boundary, and assert the same behaviour.
 */
const ASK_LIMIT = 5;
process.env.AGENT_ASK_PER_USER_MIN = String(ASK_LIMIT);

const { POST } = await import("@/app/api/agent/route");
const { __resetTasks } = await import("@/lib/agent/orchestrator");

let tenant: TestTenant;
let other: TestTenant;

beforeAll(async () => {
  tenant = await createTenant("agent");
  other = await createTenant("agent-other");
});

afterAll(async () => {
  await cleanupTenant(tenant.businessId);
  await cleanupTenant(other.businessId);
});

beforeEach(async () => {
  __resetTasks();
  auth.current = { businessId: tenant.businessId, userId: tenant.userId, ownerName: "Test Owner" };
  model.reply = null;
  // Each test starts with a clean allowance, or the twentieth message in the
  // file would fail the first assertion of an unrelated test.
  await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" LIKE ${`agent%${tenant.userId}`}`;
});

const post = async (body: Record<string, unknown>) => {
  const res = await POST(fakeRequest("http://t/api/agent", { body }) as never, {} as never);
  return { status: res.status, body: (await res.json()) as Record<string, never> };
};

/**
 * Scoped to one task rather than to the business, because AuditLog is
 * append-only at the database level — there is no clearing it between tests,
 * and a trigger that refuses the attempt is the trail doing its job.
 */
const trailRows = (taskId: string) =>
  db.auditLog.findMany({
    where: { businessId: tenant.businessId, entityType: "AgentTask", entityId: taskId },
    orderBy: { createdAt: "asc" },
  });

const startWork: AgentResponse = {
  kind: "action",
  workflowId: "work.start",
  fields: { machine: "Test JCB", customer: "cus_1", site: "Wakad", startHourMeter: 1200 },
};

describe("POST /api/agent", () => {
  it("refuses a caller with no session, before any model call", async () => {
    auth.current = null;
    model.reply = startWork;
    const res = await post({ action: "message", lang: "en", text: "start work" });
    expect(res.status).toBe(401);
  });

  it("asks for approval, writes no trail entry, then records the approval", async () => {
    model.reply = startWork;
    const proposed = await post({ action: "message", lang: "en", text: "Test JCB ka kaam shuru karo" });
    expect(proposed.body.state).toBe("READY_FOR_CONFIRMATION");
    expect(proposed.body.plan).toBeUndefined();
    // Proposed is not approved: an entry here would read as consent.
    expect(await trailRows(proposed.body.taskId)).toHaveLength(0);

    const approved = await post({ action: "confirm", lang: "en", taskId: proposed.body.taskId });
    expect(approved.body.state).toBe("EXECUTING");
    expect(approved.body.plan).toBeTruthy();

    const rows = await trailRows(proposed.body.taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("assistant.approved");
    expect(rows[0]!.entityId).toBe(proposed.body.taskId);
    expect(rows[0]!.actorType).toBe("OWNER");
    expect(rows[0]!.userId).toBe(tenant.userId);
    // What makes an assistant-driven change tellable from a typed one.
    expect(rows[0]!.details).toMatchObject({ via: "assistant", workflowId: "work.start", effect: "WRITE" });
    // And the figures the owner actually approved.
    expect(rows[0]!.after).toMatchObject({ site: "Wakad", startHourMeter: 1200 });
  });

  it("records the outcome the browser reported", async () => {
    model.reply = startWork;
    const proposed = await post({ action: "message", lang: "en", text: "start work" });
    await post({ action: "confirm", lang: "en", taskId: proposed.body.taskId });
    const done = await post({ action: "result", lang: "en", taskId: proposed.body.taskId, verified: true });
    expect(done.body.state).toBe("SUCCEEDED");

    const rows = await trailRows(proposed.body.taskId);
    expect(rows.map((r) => r.action)).toEqual(["assistant.approved", "assistant.executed"]);
  });

  it("records a result the screen never confirmed as being in doubt", async () => {
    model.reply = startWork;
    const proposed = await post({ action: "message", lang: "en", text: "start work" });
    await post({ action: "confirm", lang: "en", taskId: proposed.body.taskId });
    await post({
      action: "result",
      lang: "en",
      taskId: proposed.body.taskId,
      verified: false,
      error: "The save button never appeared.",
    });

    const rows = await trailRows(proposed.body.taskId);
    expect(rows.at(-1)!.action).toBe("assistant.unverified");
    expect(rows.at(-1)!.details).toMatchObject({ screenSaid: "The save button never appeared." });
  });

  it("leaves no trail for a question, and answers it from the screen", async () => {
    model.reply = { kind: "action", workflowId: "business.dashboard.view", fields: {} };
    const asked = await post({ action: "message", lang: "en", text: "is mahine kitna kaam hua?" });
    // A read needs no approval, so it goes straight to a plan.
    expect(asked.body.state).toBe("EXECUTING");

    const answered = await post({
      action: "result",
      lang: "en",
      taskId: asked.body.taskId,
      verified: true,
      screenText: "Hours This Month 126.3 hrs",
    });
    expect(answered.body.say).toContain("126");
    expect(await trailRows(asked.body.taskId)).toHaveLength(0);
  });

  it("will not let one owner approve another's task", async () => {
    model.reply = startWork;
    const proposed = await post({ action: "message", lang: "en", text: "start work" });

    auth.current = { businessId: other.businessId, userId: other.userId, ownerName: "Other Owner" };
    const stolen = await post({ action: "confirm", lang: "en", taskId: proposed.body.taskId });
    expect(stolen.body.plan).toBeUndefined();
    expect(stolen.body.say).toMatch(/expired/i);

    // And nothing was written against either business.
    expect(await trailRows(proposed.body.taskId)).toHaveLength(0);
    expect(
      await db.auditLog.count({ where: { businessId: other.businessId, entityType: "AgentTask" } }),
    ).toBe(0);
  });

  it("stops a runaway loop of model calls", async () => {
    model.reply = { kind: "reply", message: "ok" };
    const results: number[] = [];
    // Two past the limit, so the refusal is not on a boundary either way.
    for (let i = 0; i < ASK_LIMIT + 2; i += 1) {
      results.push((await post({ action: "message", lang: "en", text: `again ${i}` })).status);
    }
    // The statuses go in the message: "expected 0 to be greater than 0" was
    // all the last failure said, and it could not distinguish a limiter that
    // did not fire from every request having failed for some other reason.
    const seen = `statuses: ${results.join(",")}`;
    expect(results.filter((s) => s === 429).length, seen).toBeGreaterThan(0);
    expect(results.slice(0, ASK_LIMIT).every((s) => s === 200), seen).toBe(true);
  });

  it("refuses a body that names a field the owner does not own", async () => {
    model.reply = { kind: "reply", message: "ok" };
    // businessId comes from the cookie, never the payload.
    const res = await post({
      action: "message",
      lang: "en",
      text: "hello",
      businessId: other.businessId,
    });
    // 422: the schema is strict, so an unknown key is a validation failure
    // rather than a value the route quietly ignores.
    expect(res.status).toBe(422);
  });
});
