import { db } from "@/lib/db";
import { fail } from "@/lib/api-error";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { isStale, resourceModified, withTx, type Tx } from "@/lib/tx";
import type { CreateSiteInput, UpdateSiteInput, UpdateSiteRatesInput } from "@/lib/validation/site";

/** `customerId` rides along so a form that already knows the site can default
 * the customer instead of asking for it again (see StartWorkDialog). */
export async function listSiteOptions(businessId: string) {
  return db.site.findMany({
    where: { businessId },
    select: { id: true, name: true, customerId: true, status: true, bucketRate: true, breakerRate: true },
    orderBy: { name: "asc" },
  });
}

/** Site names are matched case-insensitively and ignoring surrounding spaces
 * (a plain equality lookup would let "Kharadi" and "kharadi" become two Site
 * rows; Prisma's `insensitive` mode is avoided on purpose because it is an
 * ILIKE, which would treat "%" / "_" typed in a name as wildcards). Every site
 * find-or-create in the app must go through this instead of querying db.site
 * directly, so a site is only ever created once regardless of how its name was
 * capitalized when typed.
 *
 * Pass `tx` to run inside the caller's transaction, so a site created for a
 * job that then fails to save does not linger. */
export async function findOrCreateSite(businessId: string, rawName: string, tx?: Tx) {
  const client = tx ?? db;
  const name = rawName.trim();
  const existing = await client.site.findMany({ where: { businessId } });
  const match = existing.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
  if (match) return match;
  return client.site.create({ data: { businessId, name } });
}

/** The day a site's FIRST rates apply from: the beginning of time, so work done before rates were
 * entered is still valued (a later change with a real date then splits history from that date on). */
export const RATES_FROM_THE_START = new Date("1970-01-01T00:00:00.000Z");

/** Row lock so concurrent edits of one site serialize (the second sees the first one's new `version`). */
async function lockSite(tx: Tx, businessId: string, id: string) {
  await tx.$queryRaw`SELECT 1 FROM "Site" WHERE "id" = ${id} AND "businessId" = ${businessId} FOR NO KEY UPDATE`;
}

async function assertCustomer(tx: Tx, businessId: string, customerId: string) {
  const customer = await tx.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true } });
  if (!customer) return fail("NOT_FOUND", "Customer not found");
  return null;
}

async function assertNameFree(tx: Tx, businessId: string, name: string, exceptId?: string) {
  const clash = (await tx.site.findMany({ where: { businessId }, select: { id: true, name: true } })).find(
    (s) => s.id !== exceptId && s.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  return clash ? fail("CONFLICT", "A site with this name already exists") : null;
}

export async function createSite(businessId: string, actor: AuditActor, input: CreateSiteInput, opts?: { tx?: Tx }) {
  return withTx(opts?.tx, async (tx) => {
    const isSelf = input.type === "SELF_SITE";
    if (!isSelf && input.customerId) {
      const missing = await assertCustomer(tx, businessId, input.customerId);
      if (missing) return missing;
    }
    const clash = await assertNameFree(tx, businessId, input.name);
    if (clash) return clash;

    const site = await tx.site.create({
      data: {
        businessId,
        name: input.name.trim(),
        type: input.type,
        status: input.status,
        customerId: isSelf ? null : (input.customerId ?? null),
        address: input.address || null,
        bucketRate: input.bucketRate ?? null,
        breakerRate: input.breakerRate ?? null,
      },
    });
    if (input.bucketRate != null || input.breakerRate != null) {
      await tx.siteRateHistory.create({
        data: {
          businessId,
          siteId: site.id,
          bucketRate: input.bucketRate ?? null,
          breakerRate: input.breakerRate ?? null,
          effectiveFrom: RATES_FROM_THE_START,
        },
      });
    }
    await recordAudit(tx, { businessId, actor, action: "site.create", entityType: "Site", entityId: site.id, after: site });
    return { site } as const;
  });
}

/** Edits a site's basics. `expectedVersion` (optimistic concurrency) refuses the edit when the row
 * has moved on; omitted = no check. Rates are changed through updateSiteRates. */
export async function updateSite(
  businessId: string,
  actor: AuditActor,
  id: string,
  input: UpdateSiteInput,
  opts?: { tx?: Tx },
) {
  return withTx(opts?.tx, async (tx) => {
    await lockSite(tx, businessId, id);
    const before = await tx.site.findFirst({ where: { id, businessId } });
    if (!before) return fail("NOT_FOUND", "Site not found");
    if (isStale(before.version, input.expectedVersion)) return resourceModified("site");

    const type = input.type ?? before.type;
    const customerId = type === "SELF_SITE" ? null : input.customerId === undefined ? before.customerId : input.customerId;
    if (type !== "SELF_SITE" && customerId && customerId !== before.customerId) {
      const missing = await assertCustomer(tx, businessId, customerId);
      if (missing) return missing;
    }
    if (input.name !== undefined) {
      const clash = await assertNameFree(tx, businessId, input.name, id);
      if (clash) return clash;
    }

    const site = await tx.site.update({
      where: { id, businessId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        type,
        customerId,
        ...(input.address !== undefined ? { address: input.address || null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        version: { increment: 1 },
      },
    });
    await recordAudit(tx, { businessId, actor, action: "site.update", entityType: "Site", entityId: id, before, after: site });
    return { site } as const;
  });
}

/**
 * Changes a site's bucket / breaker rates from `effectiveFrom` (default today). Writes a
 * SiteRateHistory row and refreshes Site.bucketRate / breakerRate (= the row in force today, allowing a day of timezone slack: the
 * latest effectiveFrom, newest first on ties) in one transaction, audited. Earlier work keeps the
 * rate in force on its date and bills keep their own BillItem snapshot, so nothing existing changes.
 */
export async function updateSiteRates(
  businessId: string,
  actor: AuditActor,
  id: string,
  input: UpdateSiteRatesInput,
  opts?: { tx?: Tx; today?: Date },
) {
  return withTx(opts?.tx, async (tx) => {
    await lockSite(tx, businessId, id);
    const before = await tx.site.findFirst({ where: { id, businessId } });
    if (!before) return fail("NOT_FOUND", "Site not found");
    if (isStale(before.version, input.expectedVersion)) return resourceModified("site");

    const todayStr = (opts?.today ?? new Date()).toISOString().slice(0, 10);
    const effectiveFrom = new Date(input.effectiveFrom ?? todayStr);
    // One day of slack: a user ahead of UTC (India) picks "today" = the server's tomorrow.
    const cutoff = new Date(new Date(todayStr).getTime() + 86_400_000);
    if (effectiveFrom.getTime() > cutoff.getTime()) {
      return fail("BAD_REQUEST", "The new rates cannot start in the future");
    }

    await tx.siteRateHistory.create({
      data: { businessId, siteId: id, bucketRate: input.bucketRate, breakerRate: input.breakerRate, effectiveFrom },
    });
    // The site's "current" rate is the history row in force today (a back-dated change must not override a newer one).
    const current = await tx.siteRateHistory.findFirst({
      where: { siteId: id, businessId, effectiveFrom: { lte: cutoff } },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    });
    const site = await tx.site.update({
      where: { id, businessId },
      data: {
        bucketRate: current?.bucketRate ?? null,
        breakerRate: current?.breakerRate ?? null,
        version: { increment: 1 },
      },
    });
    await recordAudit(tx, {
      businessId,
      actor,
      action: "site.rates",
      entityType: "Site",
      entityId: id,
      before: { bucketRate: before.bucketRate, breakerRate: before.breakerRate },
      after: { bucketRate: site.bucketRate, breakerRate: site.breakerRate },
      details: { effectiveFrom: effectiveFrom.toISOString().slice(0, 10) },
    });
    return { site } as const;
  });
}
