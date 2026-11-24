import { db } from "@/lib/db";
import { fail } from "@/lib/api-error";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { isStale, lockBusiness, resourceModified, withTx, type Tx } from "@/lib/tx";
import { computeServiceStatus } from "@/lib/services/serviceStatus";
import { listOpenWorkRequestsForExcavator } from "@/lib/services/operatorWorkRequests";
import { findOrCreateSite } from "@/lib/services/sites";
import { lockOwnedExcavator, roundHours } from "@/lib/services/workSessions";
import type { AddExcavatorInput, EditExcavatorInput } from "@/lib/validation/excavator";

async function getMaintenanceSettings(businessId: string) {
  return db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { defaultServiceIntervalHrs: true, maintenanceAlertThresholdHrs: true },
  });
}

export async function listExcavators(businessId: string) {
  const [excavators, { defaultServiceIntervalHrs: defaultInterval, maintenanceAlertThresholdHrs }] = await Promise.all([
    db.excavator.findMany({
      where: { businessId, isArchived: false },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        workSessions: {
          where: { status: "ACTIVE" },
          take: 1,
          include: { customer: true, site: true },
        },
        currentOperator: { select: { id: true, name: true } },
        currentSite: { select: { name: true } },
        serviceRecords: {
          orderBy: [{ serviceDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          take: 1,
        },
      },
    }),
    getMaintenanceSettings(businessId),
  ]);

  return excavators.map((excavator) => {
    const activeWork = excavator.workSessions[0] ?? null;
    const lastService = excavator.serviceRecords[0] ?? null;
    const serviceStatus = computeServiceStatus({
      currentHourMeter: excavator.currentHourMeter,
      startingHourMeter: excavator.startingHourMeter,
      serviceIntervalHrs: excavator.serviceIntervalHrs,
      businessDefaultIntervalHrs: defaultInterval,
      lastServiceHourMeter: lastService?.hourMeterAtService,
      lastServiceNextDueHour: lastService?.nextServiceDueHour,
      dueSoonThresholdHrs: maintenanceAlertThresholdHrs,
    });

    return {
      id: excavator.id,
      name: excavator.name,
      machineNumber: excavator.machineNumber,
      brand: excavator.brand,
      model: excavator.model,
      currentHourMeter: excavator.currentHourMeter,
      status: excavator.status,
      currentCustomer: activeWork?.customer.name ?? null,
      // A running job's site takes priority (it's what's actually happening
      // right now); otherwise fall back to the machine's stable admin-set
      // default site (Excavator.currentSiteId, see SiteCard) so a site that
      // was set outside of an active job still shows up on the card.
      currentSite: activeWork?.site.name ?? excavator.currentSite?.name ?? null,
      assignedOperator: excavator.currentOperator?.name ?? null,
      serviceStatus,
    };
  });
}

export async function createExcavator(
  businessId: string,
  actor: AuditActor,
  input: AddExcavatorInput,
  opts?: { tx?: Tx },
) {
  return withTx(opts?.tx, async (tx) => {
    const last = await tx.excavator.aggregate({ where: { businessId }, _max: { sortOrder: true } });
    const startingHourMeter = roundHours(input.startingHourMeter);
    const excavator = await tx.excavator.create({
      data: {
        businessId,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        name: input.name,
        machineNumber: input.machineNumber || null,
        brand: input.brand || null,
        model: input.model || null,
        purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : null,
        startingHourMeter,
        currentHourMeter: startingHourMeter,
        serviceIntervalHrs: input.serviceIntervalHrs ?? null,
      },
    });
    await recordAudit(tx, {
      businessId,
      actor,
      action: "excavator.create",
      entityType: "Excavator",
      entityId: excavator.id,
      after: excavator,
    });
    return excavator;
  });
}

const IDLE_ALERT_DAYS = 7;

export async function getExcavatorDetail(businessId: string, id: string) {
  const excavator = await db.excavator.findFirst({
    where: { id, businessId },
    include: {
      workSessions: {
        where: { status: "ACTIVE" },
        take: 1,
        include: {
          customer: true,
          site: true,
          dailyLogs: { orderBy: { date: "desc" } },
        },
      },
      currentOperator: { select: { id: true, name: true, mobile: true } },
      currentSite: { select: { id: true, name: true } },
      serviceRecords: { orderBy: [{ serviceDate: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 1 },
    },
  });

  if (!excavator) return null;

  const [{ defaultServiceIntervalHrs: defaultInterval, maintenanceAlertThresholdHrs }, operatorWorkRequests, lastCompleted, lastSession] =
    await Promise.all([
      getMaintenanceSettings(businessId),
      listOpenWorkRequestsForExcavator(id, businessId),
      db.workSession.findFirst({
        where: { businessId, excavatorId: id, status: "COMPLETED" },
        orderBy: { endDate: "desc" },
        select: { endDate: true },
      }),
      // Fallback for the Start Work dialog's Site field when the machine
      // has no currentSiteId set yet — whichever site it was last sent to,
      // regardless of that job's status.
      db.workSession.findFirst({
        where: { excavatorId: id, businessId },
        orderBy: { startDate: "desc" },
        select: { site: { select: { name: true } } },
      }),
    ]);
  const lastService = excavator.serviceRecords[0] ?? null;
  const serviceStatus = computeServiceStatus({
    currentHourMeter: excavator.currentHourMeter,
    startingHourMeter: excavator.startingHourMeter,
    serviceIntervalHrs: excavator.serviceIntervalHrs,
    businessDefaultIntervalHrs: defaultInterval,
    lastServiceHourMeter: lastService?.hourMeterAtService,
    lastServiceNextDueHour: lastService?.nextServiceDueHour,
    dueSoonThresholdHrs: maintenanceAlertThresholdHrs,
  });

  // Idle notice lives here on the machine's own page rather than in the
  // business-wide alert feed — one machine sitting idle isn't urgent enough
  // to surface everywhere, but the owner should still see it when they look
  // at this specific machine.
  const lastIdleSince = lastCompleted?.endDate ?? excavator.createdAt;
  const idleDays = Math.floor((Date.now() - lastIdleSince.getTime()) / (1000 * 60 * 60 * 24));
  const isIdleAlert = excavator.status === "IDLE" && idleDays >= IDLE_ALERT_DAYS;

  return {
    excavator,
    activeWork: excavator.workSessions[0] ?? null,
    operatorWorkRequests,
    serviceStatus,
    idleDays,
    isIdleAlert,
    defaultSiteName: excavator.currentSite?.name ?? lastSession?.site.name ?? null,
  };
}

/** Owner edit of a machine's details. `input.expectedVersion` (the version the
 * edit form loaded) makes a concurrent edit a RESOURCE_MODIFIED conflict
 * instead of a silent overwrite. */
export async function updateExcavator(
  businessId: string,
  actor: AuditActor,
  id: string,
  input: EditExcavatorInput,
  opts?: { tx?: Tx },
) {
  return withTx(opts?.tx, async (tx) => {
    if (!(await lockOwnedExcavator(tx, businessId, id))) return fail("NOT_FOUND", "Machine not found");
    const before = await tx.excavator.findFirst({ where: { id, businessId } });
    if (!before) return fail("NOT_FOUND", "Machine not found");
    if (isStale(before.version, input.expectedVersion)) return resourceModified("machine");

    const after = await tx.excavator.update({
      where: { id, businessId },
      data: {
        name: input.name,
        machineNumber: input.machineNumber || null,
        brand: input.brand || null,
        model: input.model || null,
        purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : null,
        serviceIntervalHrs: input.serviceIntervalHrs ?? null,
        version: { increment: 1 },
      },
    });
    await recordAudit(tx, {
      businessId,
      actor,
      action: "excavator.update",
      entityType: "Excavator",
      entityId: id,
      before,
      after,
    });
    return { ok: true, version: after.version } as const;
  });
}

/** Removes a machine from the active list. Its history (jobs, service records,
 * bills) stays on record — it is an archive, never a hard delete. */
export async function archiveExcavator(
  businessId: string,
  actor: AuditActor,
  id: string,
  opts?: { tx?: Tx; expectedVersion?: number },
) {
  return withTx(opts?.tx, async (tx) => {
    if (!(await lockOwnedExcavator(tx, businessId, id))) return fail("NOT_FOUND", "Machine not found");
    const before = await tx.excavator.findFirst({ where: { id, businessId } });
    if (!before) return fail("NOT_FOUND", "Machine not found");
    if (isStale(before.version, opts?.expectedVersion)) return resourceModified("machine");
    if (before.isArchived) return { ok: true, version: before.version } as const;

    const after = await tx.excavator.update({
      where: { id, businessId },
      data: { isArchived: true, version: { increment: 1 } },
    });
    await recordAudit(tx, {
      businessId,
      actor,
      action: "excavator.archive",
      entityType: "Excavator",
      entityId: id,
      before,
      after,
    });
    return { ok: true, version: after.version } as const;
  });
}

/** Admin's direct site-set — takes effect immediately, unlike an Operator's
 * proposed site change on a job request, which only updates this once
 * approved (see approveWorkRequest in operatorWorkRequests.ts). */
export async function setExcavatorSite(
  businessId: string,
  actor: AuditActor,
  excavatorId: string,
  siteName: string,
  opts?: { tx?: Tx },
) {
  return withTx(opts?.tx, async (tx) => {
    if (!(await lockOwnedExcavator(tx, businessId, excavatorId))) return fail("NOT_FOUND", "Machine not found");
    const before = await tx.excavator.findFirst({ where: { id: excavatorId, businessId } });
    if (!before) return fail("NOT_FOUND", "Machine not found");

    const site = await findOrCreateSite(businessId, siteName, tx);
    if (before.currentSiteId === site.id) return { site } as const;

    const after = await tx.excavator.update({
      where: { id: excavatorId, businessId },
      data: { currentSiteId: site.id, version: { increment: 1 } },
    });
    await recordAudit(tx, {
      businessId,
      actor,
      action: "excavator.update",
      entityType: "Excavator",
      entityId: excavatorId,
      before,
      after,
      details: { change: "site", siteName: site.name },
    });
    return { site } as const;
  });
}

export async function listExcavatorOptions(businessId: string) {
  return db.excavator.findMany({
    where: { businessId, isArchived: false },
    select: {
      id: true,
      name: true,
      machineNumber: true,
      currentHourMeter: true,
      status: true,
      currentSite: { select: { name: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

/** Saves the admin's custom machine order. `orderedIds` is the full list of
 * the business's active machines in the desired order. Ids that are not this
 * business's machines are ignored (never read, never written) and only the
 * machines whose position actually changes are touched — each of those counts
 * as a write, so its `version` moves. */
export async function reorderExcavators(businessId: string, orderedIds: string[]) {
  const requested = [...new Set(orderedIds)];
  return withTx(undefined, async (tx) => {
    // Two reorders at once (two devices) used to interleave their per-machine updates into a mixed order
    // with duplicate positions. Serialize them per business and read the current order AFTER taking the lock.
    await lockBusiness(tx, businessId);
    const owned = await tx.excavator.findMany({
      where: { businessId, id: { in: requested } },
      select: { id: true, sortOrder: true },
    });
    const currentOrder = new Map(owned.map((e) => [e.id, e.sortOrder]));
    const ids = requested.filter((id) => currentOrder.has(id));

    for (const [index, id] of ids.entries()) {
      const position = index + 1;
      if (currentOrder.get(id) === position) continue;
      await tx.excavator.update({
        where: { id, businessId },
        data: { sortOrder: position, version: { increment: 1 } },
      });
    }
    return { count: ids.length, ignored: requested.length - ids.length };
  });
}

/** True when the machine exists in THIS business (archived machines included).
 * Routes that list data belonging to a machine use it to answer 404 for another
 * tenant's (or a nonexistent) id instead of an empty 200. */
export async function excavatorInBusiness(businessId: string, id: string) {
  return (await db.excavator.count({ where: { id, businessId } })) > 0;
}
