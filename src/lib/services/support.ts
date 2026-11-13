import { fail } from "@/lib/api-error";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { SUPPORT_ACTOR } from "@/lib/supportTokens";
import { lockBusiness } from "@/lib/tx";
import { normalizeBusinessCode } from "@/lib/utils/businessCode";

/** Context every support mutation records in its audit entry. `supportSessionId`
 * ties the entry to the console session that did it (there is one shared support
 * credential, so there is no individual to name — see SUPPORT_ACTOR). */
export type SupportOpts = { supportSessionId?: string; reason?: string | null };

const supportDetails = (opts?: SupportOpts) => (opts?.supportSessionId ? { supportSessionId: opts.supportSessionId } : {});

/** Every business on the platform, with the same at-a-glance stats the
 * support console's business directory shows. Not scoped by businessId —
 * this is the one legitimate cross-tenant read in the whole app, gated
 * entirely by the caller having already verified a support session. */
export async function listBusinessesForSupport() {
  const businesses = await db.business.findMany({ orderBy: { name: "asc" } });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  return Promise.all(
    businesses.map(async (business) => {
      const [userCount, operatorCount, customerCount, excavatorCount, billsToday] = await Promise.all([
        db.user.count({ where: { businessId: business.id } }),
        db.operator.count({ where: { businessId: business.id, isArchived: false } }),
        db.customer.count({ where: { businessId: business.id, isArchived: false } }),
        db.excavator.count({ where: { businessId: business.id, isArchived: false } }),
        db.bill.count({ where: { businessId: business.id, createdAt: { gte: startOfToday } } }),
      ]);
      return {
        id: business.id,
        code: business.code,
        name: business.name,
        createdAt: business.createdAt,
        frozen: business.frozen,
        maxOperators: business.maxOperators,
        maxBillsPerDay: business.maxBillsPerDay,
        userCount,
        operatorCount,
        customerCount,
        excavatorCount,
        billsToday,
      };
    }),
  );
}

/** The user impersonate signs in as — always the business's longest-standing
 * owner account, matching listBusinessesForSupport's userCount (every User
 * row, not just one). Returns a failure if the business has no owner account
 * left to access (shouldn't normally happen, but a business is never left
 * completely inaccessible from support's perspective by construction).
 *
 * Read-only on purpose: the "support.impersonate" audit entry is written by
 * authenticateSupportImpersonation (services/auth.ts), the one place every
 * impersonated sign-in must pass through — including a direct call to the
 * NextAuth callback that never touches this route. */
export async function findImpersonationTarget(businessCode: string) {
  const business = await db.business.findUnique({ where: { code: normalizeBusinessCode(businessCode) } });
  if (!business) return fail("NOT_FOUND", "No business found with that code");

  const owner = await db.user.findFirst({ where: { businessId: business.id, role: "OWNER" }, orderBy: { createdAt: "asc" } });
  if (!owner) return fail("NOT_FOUND", "This business has no admin account to access");

  return { business, owner } as const;
}

/** Locks/unlocks a business — enforced server-side on every API route (see
 * requireBusinessApi), not just a frontend overlay. Takes effect for a
 * signed-in owner the next time their client polls /api/layout (this app
 * has no real-time push channel, so it isn't instant the way the reference
 * app's SSE-based freeze is — the next poll interval, typically well under
 * a minute, is the ceiling here). Audited (actor SUPPORT) in the same
 * transaction as the change. */
export async function setBusinessFrozen(businessCode: string, frozen: boolean, opts?: SupportOpts) {
  const business = await db.business.findUnique({ where: { code: normalizeBusinessCode(businessCode) } });
  if (!business) return fail("NOT_FOUND", "No business found with that code");

  const updated = await db.$transaction(async (tx) => {
    // Lock, then read the CURRENT state: freeze and unfreeze arriving together must each audit the state
    // they actually changed (the unlocked read above could be stale by the time we write).
    await lockBusiness(tx, business.id);
    const current = await tx.business.findUniqueOrThrow({ where: { id: business.id }, select: { frozen: true } });
    const row = await tx.business.update({ where: { id: business.id }, data: { frozen } });
    await recordAudit(tx, {
      businessId: business.id,
      actor: SUPPORT_ACTOR,
      action: frozen ? "support.freeze" : "support.unfreeze",
      entityType: "Business",
      entityId: business.id,
      before: { frozen: current.frozen },
      after: { frozen: row.frozen },
      reason: opts?.reason,
      details: supportDetails(opts),
    });
    return row;
  });
  return { business: updated } as const;
}

/** How long a diagnostics window may be opened for. Long enough to reproduce a
 * complaint, short enough that nobody is recorded for a week by accident. */
const MAX_DIAGNOSTICS_HOURS = 24;

/**
 * Open (or close) a diagnostics window on one business's assistant.
 *
 * While it is open, what the owner says and what the model replies are kept
 * for a few days so support can answer "why did it understand me that way" —
 * a question the audit trail cannot, because the trail records what was
 * approved, not what was heard. Those are also the sensitive parts, which is
 * why this is a window that closes itself rather than a switch, why it is
 * capped, and why closing it deletes what was collected (see
 * sweepDiagnostics).
 *
 * Audited as SUPPORT, with the reason, like every other support action.
 */
export async function setBusinessDiagnostics(
  businessCode: string,
  hours: number | null,
  opts?: SupportOpts,
) {
  const business = await db.business.findUnique({ where: { code: normalizeBusinessCode(businessCode) } });
  if (!business) return fail("NOT_FOUND", "No business found with that code");

  if (hours !== null && (!Number.isFinite(hours) || hours <= 0 || hours > MAX_DIAGNOSTICS_HOURS)) {
    return fail(
      "VALIDATION_FAILED",
      `Diagnostics can be switched on for 1 to ${MAX_DIAGNOSTICS_HOURS} hours, or off.`,
    );
  }

  const diagnosticsUntil = hours === null ? null : new Date(Date.now() + hours * 60 * 60 * 1000);

  const updated = await db.$transaction(async (tx) => {
    await lockBusiness(tx, business.id);
    const current = await tx.business.findUniqueOrThrow({
      where: { id: business.id },
      select: { diagnosticsUntil: true },
    });
    const row = await tx.business.update({ where: { id: business.id }, data: { diagnosticsUntil } });
    await recordAudit(tx, {
      businessId: business.id,
      actor: SUPPORT_ACTOR,
      action: diagnosticsUntil ? "support.assistant_diagnostics_on" : "support.assistant_diagnostics_off",
      entityType: "Business",
      entityId: business.id,
      before: { diagnosticsUntil: current.diagnosticsUntil },
      after: { diagnosticsUntil: row.diagnosticsUntil },
      reason: opts?.reason,
      details: supportDetails(opts),
    });
    return row;
  });

  // Closing the window takes what it collected with it: "off" has to mean off,
  // not off from now on.
  if (!diagnosticsUntil) {
    const { sweepDiagnostics } = await import("@/lib/agent/diagnostics");
    await sweepDiagnostics();
  }

  return { business: updated } as const;
}

function parseLimit(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive whole number, or left blank for unlimited`);
  }
  return n;
}

/** null/blank means unlimited. Enforced at operator creation (see
 * createOperator in operators.ts) and bill creation (see createBill and
 * createDirectBill in bills.ts) respectively. Audited (actor SUPPORT). */
export async function setBusinessLimits(
  businessCode: string,
  input: { maxOperators?: unknown; maxBillsPerDay?: unknown },
  opts?: SupportOpts,
) {
  const business = await db.business.findUnique({ where: { code: normalizeBusinessCode(businessCode) } });
  if (!business) return fail("NOT_FOUND", "No business found with that code");

  let maxOperators: number | null;
  let maxBillsPerDay: number | null;
  try {
    maxOperators = parseLimit(input.maxOperators, "Max operators");
    maxBillsPerDay = parseLimit(input.maxBillsPerDay, "Max bills per day");
  } catch (err) {
    return fail("VALIDATION_FAILED", err instanceof Error ? err.message : "Invalid limit");
  }

  const updated = await db.$transaction(async (tx) => {
    await lockBusiness(tx, business.id);
    const current = await tx.business.findUniqueOrThrow({ where: { id: business.id }, select: { maxOperators: true, maxBillsPerDay: true } });
    const row = await tx.business.update({ where: { id: business.id }, data: { maxOperators, maxBillsPerDay } });
    await recordAudit(tx, {
      businessId: business.id,
      actor: SUPPORT_ACTOR,
      action: "support.setLimits",
      entityType: "Business",
      entityId: business.id,
      before: { maxOperators: current.maxOperators, maxBillsPerDay: current.maxBillsPerDay },
      after: { maxOperators, maxBillsPerDay },
      reason: opts?.reason,
      details: supportDetails(opts),
    });
    return row;
  });
  return { business: updated } as const;
}

/**
 * Wipes revenue/business-side data for one business — bills, payments,
 * work sessions, service history, expenses, machines, customers, sites,
 * bank accounts, bill numbering. Deliberately keeps the Business row
 * itself, its owner User account(s) (so the business can still log in),
 * its Operator (driver) records, AND every OperatorTransaction/
 * TransactionCategory — an operator's full salary/money history (advances,
 * deductions, bonuses, payments) survives untouched, since that's real
 * money already paid or owed, not mistaken revenue. The operators' working
 * periods (OperatorWorkingPeriod) and leaves (OperatorLeave) are kept for the
 * same reason: salary is computed from them, so wiping them would silently
 * change what each operator is owed. This is a reset of
 * mistaken/test business data, not a delete-the-tenant operation.
 *
 * AuditLog is never touched (the table is append-only at the database level
 * too): the trail of what happened to this business survives the wipe, and
 * the wipe itself is recorded in it.
 *
 * OperatorWorkRequest/OperatorAssignment (a machine's work-request and
 * assignment history) are cleared explicitly, but would be wiped anyway as
 * soon as their Excavator is deleted below (both have a Cascade FK to
 * Excavator) — deleting them first is just for clean ordering.
 *
 * Order matters: Bill/WorkSession/ServiceRecord/ExcavatorExpense are
 * cleared first because Excavator/Customer/Site have Restrict (not
 * Cascade) foreign keys from those tables — Postgres would refuse to
 * delete an Excavator/Customer/Site still referenced by one. Everything
 * runs in a single transaction so a failure partway through can't leave
 * the business in a half-wiped state.
 */
export async function clearBusinessData(businessCode: string, opts?: SupportOpts) {
  const business = await db.business.findUnique({ where: { code: normalizeBusinessCode(businessCode) } });
  if (!business) return fail("NOT_FOUND", "No business found with that code");

  const businessId = business.id;

  const counts = await db.$transaction(
    async (tx) => {
      const bills = await tx.bill.deleteMany({ where: { businessId } }); // cascades BillItem, Payment
      const workSessions = await tx.workSession.deleteMany({ where: { businessId } }); // cascades DailyWorkLog
      const serviceRecords = await tx.serviceRecord.deleteMany({ where: { businessId } }); // cascades ServiceRecordItem
      const expenses = await tx.excavatorExpense.deleteMany({ where: { businessId } });
      const workRequests = await tx.operatorWorkRequest.deleteMany({ where: { businessId } });
      const assignments = await tx.operatorAssignment.deleteMany({ where: { businessId } });
      const excavators = await tx.excavator.deleteMany({ where: { businessId } });
      const customers = await tx.customer.deleteMany({ where: { businessId } });
      const sites = await tx.site.deleteMany({ where: { businessId } });
      const bankAccounts = await tx.bankAccount.deleteMany({ where: { businessId } });
      const sequences = await tx.billNumberSequence.deleteMany({ where: { businessId } });
      // Stored responses of earlier creates: replaying one after the data it
      // points at is gone would hand a client a bill that no longer exists.
      await tx.idempotencyKey.deleteMany({ where: { businessId } });

      const result = {
        bills: bills.count,
        workSessions: workSessions.count,
        serviceRecords: serviceRecords.count,
        expenses: expenses.count,
        workRequests: workRequests.count,
        assignments: assignments.count,
        excavators: excavators.count,
        customers: customers.count,
        sites: sites.count,
        bankAccounts: bankAccounts.count,
        sequences: sequences.count,
      };

      await recordAudit(tx, {
        businessId,
        actor: SUPPORT_ACTOR,
        action: "support.clearData",
        entityType: "Business",
        entityId: businessId,
        reason: opts?.reason,
        details: { ...result, ...supportDetails(opts) },
      });
      return result;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  return { business, counts } as const;
}
