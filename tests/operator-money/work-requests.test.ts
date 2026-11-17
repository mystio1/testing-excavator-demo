import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";
import { assignOperator } from "@/lib/services/operatorAssignments";
import {
  approveWorkRequest,
  editOperatorWorkRequest,
  endOperatorWork,
  listPendingWorkRequests,
  rejectWorkRequest,
  startOperatorWork,
} from "@/lib/services/operatorWorkRequests";
import {
  approveWorkRequestBodySchema,
  type ApproveWorkRequestInput,
} from "@/lib/validation/operatorWorkRequest";
import { cleanupTenant, createTenant, type TestTenant } from "../helpers/tenant";

/**
 * The operator-reported job flow (start -> end -> admin approve/reject) turns
 * an operator's readings into a billable WorkSession, so every step is audited
 * and the approval is exactly-once under a row lock.
 */

let t: TestTenant;
let other: TestTenant;
let operator: AuditActor;

function ok<T>(result: T): Exclude<T, { error: string }> {
  if (result && typeof result === "object" && "error" in result) {
    throw new Error(`expected success, got ${JSON.stringify(result)}`);
  }
  return result as Exclude<T, { error: string }>;
}

const operatorActor = (tenant: TestTenant): AuditActor => ({
  type: "OPERATOR",
  id: tenant.operatorId,
  name: `operator:${tenant.operatorId}`,
});

/** A PENDING request (started and ended by the operator) awaiting approval. */
async function pendingRequest(tenant = t, readings = { start: 100, end: 108.5 }) {
  const actor = operatorActor(tenant);
  ok(await assignOperator(tenant.businessId, tenant.actor, { excavatorId: tenant.excavatorId, operatorId: tenant.operatorId }));
  const started = ok(
    await startOperatorWork(tenant.businessId, tenant.operatorId, actor, { startDate: "2026-10-01", startHourMeter: readings.start, siteName: "Alpha Site", attachment: "Bucket" }),
  );
  const ended = ok(
    await endOperatorWork(tenant.businessId, tenant.operatorId, actor, { requestId: started.request.id, endHourMeter: readings.end }),
  );
  return ended.request;
}

const approval = (requestId: string, over: Partial<ApproveWorkRequestInput> = {}): ApproveWorkRequestInput => ({
  requestId,
  customerId: t.customerId,
  siteName: "Alpha Site",
  startHourMeter: 100,
  endHourMeter: 108.5,
  attachment: "Bucket",
  ...over,
});

const auditFor = (tenant: TestTenant, entityId: string) =>
  db.auditLog.findMany({
    where: { businessId: tenant.businessId, entityType: "OperatorWorkRequest", entityId },
    orderBy: { createdAt: "asc" },
  });

beforeAll(async () => {
  t = await createTenant("wreq");
  other = await createTenant("wreq-other");
  operator = operatorActor(t);
});

afterAll(async () => {
  await cleanupTenant(t.businessId);
  await cleanupTenant(other.businessId);
});

describe("operator start / end / edit", () => {
  it("start requires an assigned machine (FORBIDDEN) and never crosses tenants", async () => {
    const lone = await createTenant("wreq-lone");
    try {
      const unassigned = await startOperatorWork(lone.businessId, lone.operatorId, operatorActor(lone), { startDate: "2026-10-01", attachment: "Bucket", startHourMeter: 5 });
      expect(unassigned).toMatchObject({ code: "FORBIDDEN" });

      // An operator id from another tenant paired with this business finds no machine.
      await assignOperator(other.businessId, other.actor, { excavatorId: other.excavatorId, operatorId: other.operatorId });
      const crossTenant = await startOperatorWork(lone.businessId, other.operatorId, operatorActor(other), { startDate: "2026-10-01", attachment: "Bucket", startHourMeter: 5 });
      expect(crossTenant).toMatchObject({ code: "FORBIDDEN" });
      expect(await db.operatorWorkRequest.count({ where: { businessId: lone.businessId } })).toBe(0);
    } finally {
      await cleanupTenant(lone.businessId);
    }
  });

  it("start audits the request, flips the machine to WORKING and bumps its version", async () => {
    await assignOperator(t.businessId, t.actor, { excavatorId: t.excavatorId, operatorId: t.operatorId });
    const before = await db.excavator.findUniqueOrThrow({ where: { id: t.excavatorId } });

    const { request } = ok(await startOperatorWork(t.businessId, t.operatorId, operator, { startDate: "2026-10-01", startHourMeter: 200.126, attachment: "Breaker" }));
    expect(request.status).toBe("ACTIVE");
    expect(request.startHourMeter).toBe(200.13); // meter readings are kept to 2 dp

    const machine = await db.excavator.findUniqueOrThrow({ where: { id: t.excavatorId } });
    expect(machine).toMatchObject({ status: "WORKING", currentHourMeter: 200.13 });
    expect(machine.version).toBe(before.version + 1);

    const audit = await auditFor(t, request.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "operator.workRequest.start", actorType: "OPERATOR", actorId: t.operatorId });
    expect(audit[0]!.after).toMatchObject({ id: request.id, status: "ACTIVE", startHourMeter: 200.13 });
  });

  it("start is refused while the admin has an ACTIVE job on the machine", async () => {
    const own = await createTenant("wreq-busy");
    try {
      await assignOperator(own.businessId, own.actor, { excavatorId: own.excavatorId, operatorId: own.operatorId });
      await db.workSession.create({
        data: {
          businessId: own.businessId,
          excavatorId: own.excavatorId,
          customerId: own.customerId,
          siteId: own.siteId,
          operatorId: own.operatorId,
          startDate: new Date(),
          startHourMeter: 10,
          status: "ACTIVE",
        },
      });
      const result = await startOperatorWork(own.businessId, own.operatorId, operatorActor(own), { startDate: "2026-10-01", attachment: "Bucket", startHourMeter: 11 });
      expect(result).toMatchObject({ code: "CONFLICT" });
    } finally {
      await cleanupTenant(own.businessId);
    }
  });

  it("end moves ACTIVE -> PENDING with before/after audit, and rejects an end reading <= start", async () => {
    await assignOperator(t.businessId, t.actor, { excavatorId: t.excavatorId, operatorId: t.operatorId });
    const { request } = ok(await startOperatorWork(t.businessId, t.operatorId, operator, { startDate: "2026-10-01", attachment: "Bucket", startHourMeter: 300 }));

    const tooLow = await endOperatorWork(t.businessId, t.operatorId, operator, { requestId: request.id, endHourMeter: 300 });
    expect(tooLow).toMatchObject({ code: "VALIDATION_FAILED" });

    const ended = ok(await endOperatorWork(t.businessId, t.operatorId, operator, { requestId: request.id, endHourMeter: 309.994 }));
    expect(ended.request).toMatchObject({ status: "PENDING", endHourMeter: 309.99 });

    const audit = await auditFor(t, request.id);
    expect(audit.map((a) => a.action)).toEqual(["operator.workRequest.start", "operator.workRequest.end"]);
    expect(audit[1]!.before).toMatchObject({ status: "ACTIVE", endHourMeter: null });
    expect(audit[1]!.after).toMatchObject({ status: "PENDING", endHourMeter: 309.99 });
  });

  it("an operator can only end their own request, in their own business", async () => {
    await assignOperator(t.businessId, t.actor, { excavatorId: t.excavatorId, operatorId: t.operatorId });
    const { request } = ok(await startOperatorWork(t.businessId, t.operatorId, operator, { startDate: "2026-10-01", attachment: "Bucket", startHourMeter: 400 }));
    const second = await db.operator.create({ data: { businessId: t.businessId, name: "Other Driver", mobile: "9666666666" } });
    const wrongOperator = await endOperatorWork(t.businessId, second.id, { type: "OPERATOR", id: second.id, name: "x" }, { requestId: request.id, endHourMeter: 410 });
    expect(wrongOperator).toMatchObject({ code: "NOT_FOUND" });
    const wrongTenant = await endOperatorWork(other.businessId, t.operatorId, operator, { requestId: request.id, endHourMeter: 410 });
    expect(wrongTenant).toMatchObject({ code: "NOT_FOUND" });
    expect((await db.operatorWorkRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("ACTIVE");
  });

  it("edit corrects an ACTIVE start reading (re-syncing the machine) and a PENDING pair of readings, each audited", async () => {
    await assignOperator(t.businessId, t.actor, { excavatorId: t.excavatorId, operatorId: t.operatorId });
    const { request } = ok(await startOperatorWork(t.businessId, t.operatorId, operator, { startDate: "2026-10-01", attachment: "Bucket", startHourMeter: 500 }));

    const fixedStart = ok(await editOperatorWorkRequest(t.businessId, t.operatorId, operator, { requestId: request.id, attachment: "Bucket", startHourMeter: 501, siteName: "Beta" }));
    expect(fixedStart.request).toMatchObject({ startHourMeter: 501, siteName: "Beta", status: "ACTIVE" });
    expect((await db.excavator.findUniqueOrThrow({ where: { id: t.excavatorId } })).currentHourMeter).toBe(501);

    ok(await endOperatorWork(t.businessId, t.operatorId, operator, { requestId: request.id, endHourMeter: 510 }));
    const missingEnd = await editOperatorWorkRequest(t.businessId, t.operatorId, operator, { requestId: request.id, attachment: "Bucket", startHourMeter: 501 });
    expect(missingEnd).toMatchObject({ code: "VALIDATION_FAILED" });
    const fixedBoth = ok(await editOperatorWorkRequest(t.businessId, t.operatorId, operator, { requestId: request.id, attachment: "Bucket", startHourMeter: 502, endHourMeter: 511 }));
    expect(fixedBoth.request).toMatchObject({ startHourMeter: 502, endHourMeter: 511, status: "PENDING" });

    const edits = (await auditFor(t, request.id)).filter((a) => a.action === "operator.workRequest.edit");
    expect(edits).toHaveLength(2);
    expect(edits[1]!.before).toMatchObject({ startHourMeter: 501, endHourMeter: 510 });
    expect(edits[1]!.after).toMatchObject({ startHourMeter: 502, endHourMeter: 511 });
  });
});

describe("approveWorkRequest", () => {
  it("creates the WorkSession, approves the request and audits it with the created session id", async () => {
    const request = await pendingRequest();
    const { session } = ok(await approveWorkRequest(t.businessId, t.actor, approval(request.id)));

    expect(session).toMatchObject({
      businessId: t.businessId,
      excavatorId: t.excavatorId,
      customerId: t.customerId,
      operatorId: t.operatorId,
      startHourMeter: 100,
      endHourMeter: 108.5,
      totalHours: 8.5,
      status: "COMPLETED",
    });

    const approved = await db.operatorWorkRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(approved).toMatchObject({ status: "APPROVED", workSessionId: session.id });
    expect(approved.reviewedAt).not.toBeNull();

    const machine = await db.excavator.findUniqueOrThrow({ where: { id: t.excavatorId } });
    expect(machine).toMatchObject({ status: "IDLE", currentHourMeter: 108.5, currentSiteId: session.siteId });

    const audit = (await auditFor(t, request.id)).filter((a) => a.action === "operator.workRequest.approve");
    expect(audit).toHaveLength(1);
    const row = audit[0]!;
    expect(row).toMatchObject({ entityType: "OperatorWorkRequest", entityId: request.id, actorType: "OWNER", actorId: t.userId });
    expect(row.before).toMatchObject({ status: "PENDING", workSessionId: null });
    expect(row.after).toMatchObject({ status: "APPROVED", workSessionId: session.id });
    expect(row.details).toMatchObject({
      workSessionId: session.id,
      customerId: t.customerId,
      siteId: session.siteId,
      totalHours: 8.5,
      excavatorId: t.excavatorId,
      excavatorHourMeterAfter: 108.5,
    });
  });

  it("the admin may correct every reading on the way through; the session reflects the corrected values", async () => {
    const request = await pendingRequest();
    const { session } = ok(await approveWorkRequest(t.businessId, t.actor, approval(request.id, { startHourMeter: 100, endHourMeter: 107.25, attachment: "Breaker", notes: "fixed" })));
    expect(session).toMatchObject({ totalHours: 7.25, endHourMeter: 107.25, attachment: "Breaker", notes: "fixed" });
  });

  it("a second approval of the same request is CONFLICT and creates no second session", async () => {
    const request = await pendingRequest();
    ok(await approveWorkRequest(t.businessId, t.actor, approval(request.id)));
    const again = await approveWorkRequest(t.businessId, t.actor, approval(request.id));
    expect(again).toMatchObject({ code: "CONFLICT" });
    expect(await db.workSession.count({ where: { businessId: t.businessId, id: (await db.operatorWorkRequest.findUniqueOrThrow({ where: { id: request.id } })).workSessionId ?? "" } })).toBe(1);
    expect((await auditFor(t, request.id)).filter((a) => a.action === "operator.workRequest.approve")).toHaveLength(1);
  });

  it("two simultaneous approvals produce exactly one WorkSession and one winner", async () => {
    const request = await pendingRequest();
    const sessionsBefore = await db.workSession.count({ where: { businessId: t.businessId } });
    const results = await Promise.all([
      approveWorkRequest(t.businessId, t.actor, approval(request.id)),
      approveWorkRequest(t.businessId, t.actor, approval(request.id)),
    ]);
    expect(results.filter((r) => "session" in r)).toHaveLength(1);
    expect(results.filter((r) => "error" in r)).toHaveLength(1);
    expect(await db.workSession.count({ where: { businessId: t.businessId } })).toBe(sessionsBefore + 1);
    expect((await auditFor(t, request.id)).filter((a) => a.action === "operator.workRequest.approve")).toHaveLength(1);
  });

  it("an unknown id and another tenant's request are NOT_FOUND; the request stays PENDING", async () => {
    const request = await pendingRequest();
    const foreignActor = other.actor;
    const foreign = await approveWorkRequest(other.businessId, foreignActor, approval(request.id, { customerId: other.customerId }));
    expect(foreign).toMatchObject({ code: "NOT_FOUND" });
    expect(await approveWorkRequest(t.businessId, t.actor, approval("nope"))).toMatchObject({ code: "NOT_FOUND" });
    expect((await db.operatorWorkRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("PENDING");
    expect(await db.auditLog.count({ where: { businessId: other.businessId, entityId: request.id } })).toBe(0);
  });

  it("a customer from another tenant is NOT_FOUND and the whole approval rolls back", async () => {
    const request = await pendingRequest();
    const sessionsBefore = await db.workSession.count({ where: { businessId: t.businessId } });
    const result = await approveWorkRequest(t.businessId, t.actor, approval(request.id, { customerId: other.customerId }));
    expect(result).toMatchObject({ code: "NOT_FOUND" });
    expect((await db.operatorWorkRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("PENDING");
    expect(await db.workSession.count({ where: { businessId: t.businessId } })).toBe(sessionsBefore);
  });

  it("no customer at all is VALIDATION_FAILED; a new customer name creates one inside the approval and audits it", async () => {
    const request = await pendingRequest();
    const none = await approveWorkRequest(t.businessId, t.actor, approval(request.id, { customerId: undefined }));
    expect(none).toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await db.operatorWorkRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("PENDING");

    const { session } = ok(
      await approveWorkRequest(t.businessId, t.actor, approval(request.id, { customerId: undefined, newCustomerName: "Brand New Co", newCustomerMobile: "9777777777" })),
    );
    const created = await db.customer.findFirstOrThrow({ where: { businessId: t.businessId, name: "Brand New Co" } });
    expect(session.customerId).toBe(created.id);
    const audit = (await auditFor(t, request.id)).find((a) => a.action === "operator.workRequest.approve");
    expect(audit!.details).toMatchObject({ createdCustomerId: created.id, workSessionId: session.id });
  });

  it("the site is found case-insensitively instead of duplicated", async () => {
    const own = await createTenant("wreq-site");
    try {
      const request = await pendingRequest(own);
      const existing = await db.site.create({ data: { businessId: own.businessId, name: "North Quarry" } });
      const { session } = ok(
        await approveWorkRequest(own.businessId, own.actor, { ...approval(request.id), customerId: own.customerId, siteName: "  north quarry " }),
      );
      expect(session.siteId).toBe(existing.id);
      expect(await db.site.count({ where: { businessId: own.businessId, name: { equals: "north quarry", mode: "insensitive" } } })).toBe(1);
    } finally {
      await cleanupTenant(own.businessId);
    }
  });

  it("body schema: end must be after start and a customer (or a new name) is required", () => {
    const fields = { siteName: "S", startHourMeter: 10, endHourMeter: 12, customerId: "c1", attachment: "Bucket" };
    expect(approveWorkRequestBodySchema.safeParse(fields).success).toBe(true);
    expect(approveWorkRequestBodySchema.safeParse({ ...fields, endHourMeter: 10 }).success).toBe(false);
    expect(approveWorkRequestBodySchema.safeParse({ ...fields, customerId: undefined }).success).toBe(false);
    expect(approveWorkRequestBodySchema.safeParse({ ...fields, customerId: undefined, newCustomerName: "New" }).success).toBe(true);
  });
});

describe("rejectWorkRequest", () => {
  it("rejects with a reason, audits it, and the operator can resubmit a corrected reading", async () => {
    const request = await pendingRequest();
    ok(await rejectWorkRequest(t.businessId, t.actor, { requestId: request.id, note: "meter looks wrong" }));

    const rejected = await db.operatorWorkRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(rejected).toMatchObject({ status: "REJECTED", rejectionNote: "meter looks wrong" });

    const audit = (await auditFor(t, request.id)).find((a) => a.action === "operator.workRequest.reject");
    expect(audit).toMatchObject({ actorType: "OWNER", actorId: t.userId, reason: "meter looks wrong" });
    expect(audit!.before).toMatchObject({ status: "PENDING" });
    expect(audit!.after).toMatchObject({ status: "REJECTED", rejectionNote: "meter looks wrong" });

    // A rejected request cannot be approved or rejected again until resubmitted.
    expect(await approveWorkRequest(t.businessId, t.actor, approval(request.id))).toMatchObject({ code: "CONFLICT" });
    expect(await rejectWorkRequest(t.businessId, t.actor, { requestId: request.id })).toMatchObject({ code: "CONFLICT" });

    const resubmitted = ok(await endOperatorWork(t.businessId, t.operatorId, operator, { requestId: request.id, endHourMeter: 107 }));
    expect(resubmitted.request).toMatchObject({ status: "PENDING", rejectionNote: null, endHourMeter: 107 });
  });

  it("another tenant cannot reject, and nothing changes", async () => {
    const request = await pendingRequest();
    const result = await rejectWorkRequest(other.businessId, other.actor, { requestId: request.id, note: "hostile" });
    expect(result).toMatchObject({ code: "NOT_FOUND" });
    expect((await db.operatorWorkRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("PENDING");
  });
});

describe("listPendingWorkRequests", () => {
  it("is tenant scoped and never exposes the operator's credentials", async () => {
    const own = await createTenant("wreq-list");
    try {
      await db.operator.update({ where: { id: own.operatorId }, data: { pinHash: "secret-pin-hash", canLogin: true } });
      const request = await pendingRequest(own);
      await pendingRequest(other);

      const rows = await listPendingWorkRequests(own.businessId);
      expect(rows.map((r) => r.id)).toEqual([request.id]);
      const text = JSON.stringify(rows);
      expect(text).not.toContain("secret-pin-hash");
      expect(rows[0]!.operator).not.toHaveProperty("pinHash");
      expect(rows[0]!.operator).not.toHaveProperty("tokenVersion");
    } finally {
      await cleanupTenant(own.businessId);
    }
  });
});
