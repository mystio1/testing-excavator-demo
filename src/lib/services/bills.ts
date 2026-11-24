import { Prisma } from "@/generated/prisma/client";
import type { Bill, BillItem, Business, BankAccount, Payment } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { fail, type ServiceFailure } from "@/lib/api-error";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { Decimal, ZERO, dec, gstSplit, lineAmount, paymentStatus, round2, sum } from "@/lib/money";
import { LEGACY_LIMIT, pageArgs, toPage, type PageParams } from "@/lib/pagination";
import { isStale, lockBill, lockBusiness, resourceModified, withTx, type Tx } from "@/lib/tx";
import type { GenerateBillInput, GenerateSummaryBillInput, UpdateBillInput } from "@/lib/validation/bill";
import type { GenerateDirectBillInput } from "@/lib/validation/directBill";
import type { BillPreviewData } from "@/components/bill/bill-preview";

export type BillLetterhead = {
  businessName: string;
  ownerName: string;
  businessAddress: string | null;
  businessPhone: string;
  businessGstin: string | null;
  businessTagline: string | null;
  logoLeftUrl: string | null;
  logoRightUrl: string | null;
  signatureUrl: string | null;
  accentColor: string;
  bankAccount: {
    label: string;
    accountHolderName: string;
    accountNumber: string;
    ifsc: string;
    bankName: string;
    branch: string | null;
  } | null;
};

const NON_GST_PREFIX = "NG-";

/** Largest value a NUMERIC(14,2) money column can hold. */
const MAX_TOTAL = dec("999999999999.99");
/** How many unbilled work records the "new bill" picker will ever return. */
const UNBILLED_CAP = 500;
/** Hard ceiling for the (non-paginated) register export. */
const EXPORT_CAP = 20_000;

const BILL_NUMBER_TAKEN_MESSAGE = "That bill number is already used — pick a different one";
// Invariant (docs/invariants.md): a REMOVED (archived) customer or bank account cannot be chosen for a new bill.
// Billing work that was already completed for such a customer from the work-record list is still allowed, so
// old work does not get stuck unbillable (there is no "restore customer" action).
const ARCHIVED_CUSTOMER_MESSAGE = "This customer was removed. Choose another customer.";
const ARCHIVED_BANK_ACCOUNT_MESSAGE = "That bank account was removed. Choose another one or none.";

// ---------------------------------------------------------------------------
// Transaction plumbing
// ---------------------------------------------------------------------------

class Rollback extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.error);
  }
}

const isFailure = (value: unknown): value is ServiceFailure =>
  typeof value === "object" && value !== null && "error" in value;

/** Runs `fn` atomically. Services return expected failures as VALUES, and a
 * failure must undo everything written so far (a consumed bill number, a
 * half-created bill…):
 *   - with no caller transaction, a returned failure rolls the transaction
 *     back here;
 *   - with a caller transaction (`opts.tx`, e.g. runIdempotent), the caller is
 *     responsible for rolling back when it sees the failure — runIdempotent
 *     does exactly that. Never commit a transaction whose service returned a
 *     failure. */
async function atomic<T extends object>(
  tx: Tx | undefined,
  fn: (tx: Tx) => Promise<T | ServiceFailure>,
): Promise<T | ServiceFailure> {
  if (tx) return fn(tx);
  try {
    return await withTx(undefined, async (inner) => {
      const result = await fn(inner);
      if (isFailure(result)) throw new Rollback(result);
      return result;
    });
  } catch (error) {
    if (error instanceof Rollback) return error.failure;
    throw error;
  }
}

/** Maps a Postgres unique-index violation to the business error it means.
 * Anything else (including other unique indexes) is rethrown by the caller. */
function uniqueViolation(error: unknown): ServiceFailure | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const detail = `${JSON.stringify(error.meta ?? {})} ${error.message}`;
  if (detail.includes("workSessionId")) {
    return fail("WORK_SESSION_ALREADY_BILLED", "One or more of these work records were just billed on another bill");
  }
  if (detail.includes("billNumber")) return fail("BILL_NUMBER_TAKEN", BILL_NUMBER_TAKEN_MESSAGE);
  return null;
}

/** SELECT … FOR UPDATE on the work records about to be billed, in id order (a
 * fixed order means two requests over overlapping sets cannot deadlock). The
 * second concurrent biller waits here, then re-reads and sees them billed. */
async function lockWorkSessions(tx: Tx, businessId: string, ids: string[]) {
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT "id" FROM "WorkSession" WHERE "businessId" = ${businessId} AND "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
}

/** Tenant-scoped lock + fresh read of a bill: confirm the bill belongs to the
 * business, take the row lock, THEN read the values the decision depends on
 * (a read made before the lock could be stale by the time it is granted). */
async function lockOwnedBill(tx: Tx, businessId: string, billId: string): Promise<Bill | null> {
  const owned = await tx.bill.findFirst({ where: { id: billId, businessId }, select: { id: true } });
  if (!owned) return null;
  await lockBill(tx, billId);
  return tx.bill.findFirst({ where: { id: billId, businessId } });
}

async function paidSum(tx: Tx, billId: string, exceptPaymentId?: string): Promise<Decimal> {
  const agg = await tx.payment.aggregate({
    where: { billId, ...(exceptPaymentId ? { id: { not: exceptPaymentId } } : {}) },
    _sum: { amount: true },
  });
  return round2(agg._sum.amount ?? ZERO);
}

// ---------------------------------------------------------------------------
// Audit snapshots
// ---------------------------------------------------------------------------

/** Full bill row for the audit trail. The letterhead (business name, logos as
 * data: URIs, bank block) is left out — it is large, and an edit re-stamps it
 * wholesale from Settings, which `letterheadRefreshed` on the entry records. */
function billSnapshot(bill: Bill, items: BillItem[], payments?: Payment[]) {
  const snapshot: Record<string, unknown> = { ...bill, items };
  delete snapshot.letterhead;
  if (payments) snapshot.payments = payments;
  return snapshot;
}

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

/** maxBillsPerDay is support-console-managed (see
 * src/lib/services/support.ts) — null/unset for every business until
 * support deliberately caps one. */
async function checkDailyBillLimit(tx: Tx, businessId: string, maxBillsPerDay: number | null) {
  if (maxBillsPerDay == null) return null;
  // Count-then-insert is a race: N simultaneous requests would all see "1 of 2 used" and all pass. Serialize
  // bill creation per business (only when a limit is set, so unlimited businesses pay nothing).
  await lockBusiness(tx, businessId);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const billsToday = await tx.bill.count({ where: { businessId, createdAt: { gte: startOfToday } } });
  if (billsToday >= maxBillsPerDay) {
    return fail("BAD_REQUEST", `You've reached your plan's limit of ${maxBillsPerDay} bills per day. Contact support to raise it.`);
  }
  return null;
}

export function buildLetterhead(business: Business, bankAccount: BankAccount | null): BillLetterhead {
  return {
    businessName: business.name,
    ownerName: business.ownerName,
    businessAddress: business.address,
    businessPhone: business.phone,
    businessGstin: business.gstNumber,
    businessTagline: business.billTagline,
    logoLeftUrl: business.logoLeftUrl,
    logoRightUrl: business.logoRightUrl,
    signatureUrl: business.signatureUrl,
    accentColor: business.billAccentColor,
    bankAccount: bankAccount
      ? {
          label: bankAccount.label,
          accountHolderName: bankAccount.accountHolderName,
          accountNumber: bankAccount.accountNumber,
          ifsc: bankAccount.ifsc,
          bankName: bankAccount.bankName,
          branch: bankAccount.branch,
        }
      : null,
  };
}

function formatNonGstNumber(prefix: string, n: number) {
  return `${prefix}${String(n).padStart(4, "0")}`;
}

/** Reserves the next Non-GST bill number unless the owner typed one in
 * manually (e.g. to match a physical bill book) — a manual entry is used
 * as-is and never advances the sequence, so the next auto number picks up
 * where it left off. Shared by every create flow.
 *
 * An auto number that collides with a manually-entered one is skipped (the
 * sequence just moves on) instead of failing forever. Returns null only if
 * 50 consecutive numbers are taken. The sequence row stays locked until the
 * transaction ends, so concurrent creators never receive the same number. */
async function resolveBillNumber(
  tx: Tx,
  businessId: string,
  billType: string,
  manualBillNumber: string | undefined,
): Promise<string | null> {
  if (billType !== "NON_GST") return manualBillNumber ?? "";
  if (manualBillNumber) return manualBillNumber;

  for (let attempt = 0; attempt < 50; attempt++) {
    const seq = await tx.billNumberSequence.upsert({
      where: { businessId_type: { businessId, type: "NON_GST" } },
      create: { businessId, type: "NON_GST", prefix: NON_GST_PREFIX, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    const candidate = formatNonGstNumber(seq.prefix, seq.lastNumber);
    if (!(await billNumberTaken(tx, businessId, candidate))) return candidate;
  }
  return null;
}

async function billNumberTaken(tx: Tx, businessId: string, billNumber: string, exceptBillId?: string) {
  const existing = await tx.bill.findFirst({
    where: { businessId, billNumber, ...(exceptBillId ? { id: { not: exceptBillId } } : {}) },
    select: { id: true },
  });
  return existing !== null;
}

type ChargeInput = {
  transportCharges: number;
  fuelCharges: number;
  extraCharges: number;
  bucketCharge: number;
  breakerCharge: number;
  discount: number;
};

/** Money typed into a form is rounded to paise once, up front, so the stored
 * column value and every figure derived from it agree exactly. Exported (with
 * normalBillTotals) so tests/unit/money-property.test.ts can check the server
 * against the client preview. */
export function readCharges(input: ChargeInput) {
  return {
    transportCharges: round2(input.transportCharges),
    fuelCharges: round2(input.fuelCharges),
    extraCharges: round2(input.extraCharges),
    bucketCharge: round2(input.bucketCharge),
    breakerCharge: round2(input.breakerCharge),
    discount: round2(input.discount),
  };
}

type DieselInput = { dieselLiters: number; dieselPricePerLiter: number; deductDiesel?: boolean };

/** Diesel the customer supplied is an advance against the bill, not a charge:
 * litres x price comes off the total. With the deduction turned off the litres
 * and price are still recorded, but nothing is taken off — so a stored
 * dieselAdvance above zero is exactly "this bill deducted diesel". */
export function readDiesel(input: DieselInput) {
  const dieselLiters = round2(input.dieselLiters);
  const dieselPricePerLiter = round2(input.dieselPricePerLiter);
  return {
    dieselLiters,
    dieselPricePerLiter,
    dieselAdvance: input.deductDiesel === false ? ZERO : lineAmount(dieselLiters, dieselPricePerLiter),
  };
}

function gstRate(billType: string, gstPercentage: number | undefined | null) {
  return billType === "GST" && gstPercentage != null ? round2(gstPercentage) : null;
}

/** subtotal + charges − discount, GST on that, and the grand total. Exact
 * decimal arithmetic, ROUND_HALF_UP to 2 dp (see src/lib/money.ts). */
export function normalBillTotals(
  subtotal: Decimal,
  charges: ReturnType<typeof readCharges>,
  billType: string,
  gstPercentage: number | undefined | null,
  /** Diesel supplied by the customer, taken off AFTER tax — it is a payment
   * against the bill, not a reduction of what is being taxed. */
  dieselAdvance: Decimal = ZERO,
) {
  const taxable = sum([
    subtotal,
    charges.transportCharges,
    charges.fuelCharges,
    charges.extraCharges,
    charges.bucketCharge,
    charges.breakerCharge,
  ]).minus(charges.discount);
  const rate = gstRate(billType, gstPercentage);
  const gst = rate ? gstSplit(taxable, rate) : null;
  const total = round2(taxable.plus(gst?.tax ?? ZERO).minus(dieselAdvance));
  return { taxable, cgst: gst?.cgst ?? null, sgst: gst?.sgst ?? null, total };
}

/** A bill can never total less than zero (the database refuses it too) nor
 * more than the column holds. */
function checkTotal(total: Decimal): ServiceFailure | null {
  if (total.lt(0)) {
    return fail("VALIDATION_FAILED", "The bill total can't be negative — the discount or diesel advance is larger than the charges");
  }
  if (total.gt(MAX_TOTAL)) return fail("VALIDATION_FAILED", "The bill total is too large");
  return null;
}

type SummaryLineInput = {
  excavatorId: string;
  siteName: string;
  attachment?: string;
  fromDate: string;
  toDate: string;
  hours: number;
  ratePerHour: number;
};

function buildSummaryLines(items: SummaryLineInput[]) {
  return items.map((i) => {
    const hours = round2(i.hours);
    const ratePerHour = round2(i.ratePerHour);
    return {
      excavatorId: i.excavatorId,
      siteName: i.siteName,
      attachment: i.attachment || null,
      fromDate: new Date(i.fromDate),
      toDate: new Date(i.toDate),
      hours,
      ratePerHour,
      amount: lineAmount(hours, ratePerHour),
    };
  });
}

/** Inserts a new bill (with its lines), maps unique-index violations to
 * their business errors, and writes the audit entry in the same transaction.
 * After a unique violation Postgres has aborted the transaction: nothing may
 * be queried on `tx` afterwards, so the failure is returned immediately. */
async function persistNewBill(tx: Tx, businessId: string, actor: AuditActor, data: Prisma.BillUncheckedCreateInput, source: string) {
  let created;
  try {
    created = await tx.bill.create({ data, include: { items: true } });
  } catch (error) {
    const failure = uniqueViolation(error);
    if (failure) return failure;
    throw error;
  }
  const { items, ...bill } = created;
  await recordAudit(tx, {
    businessId,
    actor,
    action: "bill.create",
    entityType: "Bill",
    entityId: bill.id,
    after: billSnapshot(bill, items),
    details: { billNumber: bill.billNumber, source },
  });
  return { bill } as const;
}

// ---------------------------------------------------------------------------
// Reads used by the "new bill" forms
// ---------------------------------------------------------------------------

export async function listUnbilledWorkSessions(
  businessId: string,
  customerId: string,
  filters?: { siteId?: string; excavatorId?: string; from?: string; to?: string },
) {
  return db.workSession.findMany({
    where: {
      businessId,
      customerId,
      status: "COMPLETED",
      billItems: { none: {} },
      ...(filters?.siteId ? { siteId: filters.siteId } : {}),
      ...(filters?.excavatorId ? { excavatorId: filters.excavatorId } : {}),
      ...(filters?.from ? { startDate: { gte: new Date(filters.from) } } : {}),
      // A session's endDate can fall on the "to" day itself, so bound it at
      // the end of that day rather than midnight — otherwise a same-day job
      // would be excluded from its own selected range.
      ...(filters?.to ? { endDate: { lte: new Date(`${filters.to}T23:59:59.999`) } } : {}),
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    // Bounded: the picker never needs more, and an unbounded list of a
    // long-running customer's history is a latent memory/latency problem.
    take: UNBILLED_CAP,
    include: {
      excavator: { select: { id: true, name: true, machineNumber: true } },
      site: { select: { name: true } },
    },
  });
}

/** Read-only peek at what the next Non-GST bill number would be — the actual
 * number is only reserved (incremented) inside the create transaction. */
export async function previewNextNonGstBillNumber(businessId: string) {
  const seq = await db.billNumberSequence.findUnique({
    where: { businessId_type: { businessId, type: "NON_GST" } },
  });
  const next = (seq?.lastNumber ?? 0) + 1;
  return formatNonGstNumber(seq?.prefix ?? NON_GST_PREFIX, next);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/** Bill logged work. The "completed and not yet billed" check runs INSIDE the
 * creating transaction, after locking those work records, and the database
 * enforces it as well (BillItem.workSessionId is UNIQUE): of two concurrent
 * requests for the same work, exactly one wins; the other gets
 * WORK_SESSION_ALREADY_BILLED and leaves nothing behind.
 *
 * `opts.tx`: run inside the caller's transaction (see atomic()). */
export async function createBill(
  businessId: string,
  actor: AuditActor,
  input: GenerateBillInput,
  opts?: { tx?: Tx },
) {
  return atomic(opts?.tx, async (tx) => {
    const ids = [...new Set(input.workSessionIds)];
    await lockWorkSessions(tx, businessId, ids);

    const [business, sessions, bankAccount] = await Promise.all([
      tx.business.findUniqueOrThrow({ where: { id: businessId } }),
      tx.workSession.findMany({
        where: {
          id: { in: ids },
          businessId,
          customerId: input.customerId,
          status: "COMPLETED",
          billItems: { none: {} },
        },
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
        include: { excavator: true, site: { select: { name: true } } },
      }),
      input.bankAccountId
        ? tx.bankAccount.findFirst({ where: { id: input.bankAccountId, businessId } })
        : Promise.resolve(null),
    ]);

    if (bankAccount?.isArchived) return fail("CONFLICT", ARCHIVED_BANK_ACCOUNT_MESSAGE);

    const limitFailure = await checkDailyBillLimit(tx, businessId, business.maxBillsPerDay);
    if (limitFailure) return limitFailure;

    if (sessions.length !== ids.length) {
      const found = new Set(sessions.map((s) => s.id));
      const missing = ids.filter((id) => !found.has(id));
      const alreadyBilled = await tx.billItem.findFirst({
        where: { workSessionId: { in: missing }, workSession: { businessId } },
        select: { id: true },
      });
      if (alreadyBilled) {
        return fail("WORK_SESSION_ALREADY_BILLED", "One or more selected work records have already been billed");
      }
      return fail("CONFLICT", "One or more selected work records are no longer available to bill");
    }

    const rate = round2(input.ratePerHour);
    const lines = sessions.map((s) => {
      const hours = round2(s.totalHours);
      return { session: s, hours, amount: lineAmount(hours, rate) };
    });
    const subtotal = sum(lines.map((l) => l.amount));
    const charges = readCharges(input);
    const diesel = readDiesel(input);
    const totals = normalBillTotals(subtotal, charges, input.billType, input.gstPercentage, diesel.dieselAdvance);
    const totalFailure = checkTotal(totals.total);
    if (totalFailure) return totalFailure;

    const billNumber = await reserveBillNumber(tx, businessId, input.billType, input.billNumber);
    if (typeof billNumber !== "string") return billNumber;

    return persistNewBill(
      tx,
      businessId,
      actor,
      {
        businessId,
        billNumber,
        billType: input.billType,
        customerId: input.customerId,
        bankAccountId: bankAccount?.id ?? null,
        billDate: new Date(input.billDate),
        subtotal,
        ...charges,
        ...diesel,
        gstPercentage: gstRate(input.billType, input.gstPercentage),
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: null,
        buyerGstin: input.buyerGstin || null,
        totalAmount: totals.total,
        notes: input.notes || null,
        showCustomerPhone: input.showCustomerPhone,
        letterhead: buildLetterhead(business, bankAccount) as object,
        items: {
          create: lines.map((l) => ({
            excavatorId: l.session.excavatorId,
            workSessionId: l.session.id,
            siteName: input.siteName || l.session.site.name,
            attachment: input.attachment || null,
            fromDate: l.session.startDate,
            toDate: l.session.endDate ?? l.session.startDate,
            hours: l.hours,
            ratePerHour: rate,
            amount: l.amount,
          })),
        },
      },
      "work-sessions",
    );
  });
}

/** resolveBillNumber + the failures it can mean: a manual number that is
 * already used (checked up front so the common case never has to abort the
 * transaction with a unique violation), or a sequence stuck behind taken
 * numbers. */
async function reserveBillNumber(
  tx: Tx,
  businessId: string,
  billType: string,
  manualBillNumber: string | undefined,
): Promise<string | ServiceFailure> {
  if (manualBillNumber || billType !== "NON_GST") {
    const requested = manualBillNumber ?? "";
    if (requested && (await billNumberTaken(tx, businessId, requested))) {
      return fail("BILL_NUMBER_TAKEN", BILL_NUMBER_TAKEN_MESSAGE);
    }
  }
  const resolved = await resolveBillNumber(tx, businessId, billType, manualBillNumber);
  if (resolved === null) return fail("BILL_NUMBER_TAKEN", "Could not find a free bill number — enter one manually");
  return resolved;
}

/** Summary Bill — a normal-style bill (customer-wise, per-machine/site
 * lines, hours × rate, optional GST) whose lines are entered directly in a
 * spreadsheet-like grid instead of being picked from already-logged work.
 * Lines carry no workSessionId, so nothing logged elsewhere is touched. */
export async function createSummaryBill(
  businessId: string,
  actor: AuditActor,
  input: GenerateSummaryBillInput,
  opts?: { tx?: Tx },
) {
  return atomic(opts?.tx, async (tx) => {
    const [business, bankAccount, machines, customer] = await Promise.all([
      tx.business.findUniqueOrThrow({ where: { id: businessId } }),
      input.bankAccountId
        ? tx.bankAccount.findFirst({ where: { id: input.bankAccountId, businessId } })
        : Promise.resolve(null),
      tx.excavator.findMany({
        where: { businessId, id: { in: input.items.map((i) => i.excavatorId) } },
        select: { id: true },
      }),
      tx.customer.findFirst({ where: { id: input.customerId, businessId }, select: { id: true, isArchived: true } }),
    ]);

    if (!customer) return fail("NOT_FOUND", "Customer not found");
    if (customer.isArchived) return fail("CONFLICT", ARCHIVED_CUSTOMER_MESSAGE);
    if (bankAccount?.isArchived) return fail("CONFLICT", ARCHIVED_BANK_ACCOUNT_MESSAGE);

    const limitFailure = await checkDailyBillLimit(tx, businessId, business.maxBillsPerDay);
    if (limitFailure) return limitFailure;

    const machineIds = new Set(machines.map((m) => m.id));
    if (input.items.some((i) => !machineIds.has(i.excavatorId))) {
      return fail("NOT_FOUND", "One of the selected machines was not found");
    }

    const items = buildSummaryLines(input.items);
    const subtotal = sum(items.map((i) => i.amount));
    const charges = readCharges(input);
    const diesel = readDiesel(input);
    const totals = normalBillTotals(subtotal, charges, input.billType, input.gstPercentage, diesel.dieselAdvance);
    const totalFailure = checkTotal(totals.total);
    if (totalFailure) return totalFailure;

    const billNumber = await reserveBillNumber(tx, businessId, input.billType, input.billNumber);
    if (typeof billNumber !== "string") return billNumber;

    return persistNewBill(
      tx,
      businessId,
      actor,
      {
        businessId,
        billNumber,
        billType: input.billType,
        customerId: input.customerId,
        bankAccountId: bankAccount?.id ?? null,
        billDate: new Date(input.billDate),
        subtotal,
        ...charges,
        ...diesel,
        gstPercentage: gstRate(input.billType, input.gstPercentage),
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: null,
        buyerGstin: input.buyerGstin || null,
        totalAmount: totals.total,
        notes: input.notes || null,
        showCustomerPhone: input.showCustomerPhone,
        letterhead: buildLetterhead(business, bankAccount) as object,
        items: { create: items },
      },
      "summary",
    );
  });
}

/** What a direct bill / direct-bill edit is made of, computed once so create
 * and update can never disagree. */
function directBillAmounts(
  input: {
    bucketHours: number;
    bucketRate: number;
    breakerHours: number;
    breakerRate: number;
    transportCharges: number;
    billType: string;
    gstPercentage?: number;
  } & DieselInput,
) {
  const bucketHours = round2(input.bucketHours);
  const bucketRate = round2(input.bucketRate);
  const breakerHours = round2(input.breakerHours);
  const breakerRate = round2(input.breakerRate);
  const { dieselLiters, dieselPricePerLiter, dieselAdvance } = readDiesel(input);
  const transportCharges = round2(input.transportCharges);

  const subtotal = round2(lineAmount(bucketHours, bucketRate).plus(lineAmount(breakerHours, breakerRate)));
  const taxable = round2(subtotal.plus(transportCharges));
  const rate = gstRate(input.billType, input.gstPercentage);
  const gst = rate ? gstSplit(taxable, rate) : null;
  const total = round2(taxable.plus(gst?.tax ?? ZERO).minus(dieselAdvance));

  return {
    bucketHours,
    bucketRate,
    breakerHours,
    breakerRate,
    dieselLiters,
    dieselPricePerLiter,
    dieselAdvance,
    transportCharges,
    subtotal,
    taxable,
    cgst: gst?.cgst ?? null,
    sgst: gst?.sgst ?? null,
    total,
  };
}

/** Direct billing — a standalone invoice for bucket/breaker hours hired
 * directly (e.g. a customer hiring a machine for a job outside the normal
 * WorkSession/DailyWorkLog flow), entered by hand instead of picked from
 * logged work history. Diesel the customer supplied is netted off the
 * total as an advance, not billed as a charge. */
export async function createDirectBill(
  businessId: string,
  actor: AuditActor,
  input: GenerateDirectBillInput,
  opts?: { tx?: Tx },
) {
  return atomic(opts?.tx, async (tx) => {
    const [business, excavator, bankAccount, customer] = await Promise.all([
      tx.business.findUniqueOrThrow({ where: { id: businessId } }),
      tx.excavator.findFirst({ where: { id: input.excavatorId, businessId } }),
      input.bankAccountId
        ? tx.bankAccount.findFirst({ where: { id: input.bankAccountId, businessId } })
        : Promise.resolve(null),
      // A direct bill used to accept ANY customer id; scope it to the tenant.
      tx.customer.findFirst({ where: { id: input.customerId, businessId }, select: { id: true, isArchived: true } }),
    ]);

    if (!customer) return fail("NOT_FOUND", "Customer not found");
    if (!excavator) return fail("NOT_FOUND", "Machine not found");
    if (customer.isArchived) return fail("CONFLICT", ARCHIVED_CUSTOMER_MESSAGE);
    if (bankAccount?.isArchived) return fail("CONFLICT", ARCHIVED_BANK_ACCOUNT_MESSAGE);

    const limitFailure = await checkDailyBillLimit(tx, businessId, business.maxBillsPerDay);
    if (limitFailure) return limitFailure;

    const amounts = directBillAmounts(input);
    if (amounts.taxable.lte(0)) {
      return fail("VALIDATION_FAILED", "Enter bucket hours, breaker hours, or transport charges");
    }
    const totalFailure = checkTotal(amounts.total);
    if (totalFailure) return totalFailure;

    const billNumber = await reserveBillNumber(tx, businessId, input.billType, input.billNumber);
    if (typeof billNumber !== "string") return billNumber;

    return persistNewBill(
      tx,
      businessId,
      actor,
      {
        businessId,
        billNumber,
        billType: input.billType,
        customerId: input.customerId,
        bankAccountId: bankAccount?.id ?? null,
        billDate: new Date(input.billDate),
        subtotal: amounts.subtotal,
        transportCharges: amounts.transportCharges,
        gstPercentage: gstRate(input.billType, input.gstPercentage),
        cgst: amounts.cgst,
        sgst: amounts.sgst,
        igst: null,
        buyerGstin: input.buyerGstin || null,
        totalAmount: amounts.total,
        notes: input.notes || null,
        showCustomerPhone: input.showCustomerPhone,
        isDirect: true,
        excavatorId: input.excavatorId,
        fromDate: new Date(input.fromDate),
        toDate: new Date(input.toDate),
        bucketHours: amounts.bucketHours,
        bucketRate: amounts.bucketRate,
        breakerHours: amounts.breakerHours,
        breakerRate: amounts.breakerRate,
        dieselLiters: amounts.dieselLiters,
        dieselPricePerLiter: amounts.dieselPricePerLiter,
        dieselAdvance: amounts.dieselAdvance,
        letterhead: buildLetterhead(business, bankAccount) as object,
      },
      "direct",
    );
  });
}

// ---------------------------------------------------------------------------
// Update / delete
// ---------------------------------------------------------------------------

/** Admin edit of a generated bill — any field, any time. Totals/GST are
 * recomputed from scratch; payments already recorded are kept and the
 * PAID/PARTIAL/UNPAID status is re-derived against the new total — which may
 * never drop below what has already been paid (BILL_TOTAL_BELOW_PAID). Lines
 * keep their WorkSession link when edited in place (so those hours stay
 * marked as billed); a removed line frees its WorkSession for rebilling.
 *
 * Runs under a row lock on the bill, so a payment recorded at the same moment
 * cannot slip in between the "paid so far" read and the write. A stale
 * `input.expectedVersion` → RESOURCE_MODIFIED. */
export async function updateBill(
  businessId: string,
  actor: AuditActor,
  id: string,
  input: UpdateBillInput,
  opts?: { tx?: Tx },
) {
  return atomic(opts?.tx, async (tx) => {
    const bill = await lockOwnedBill(tx, businessId, id);
    if (!bill) return fail("NOT_FOUND", "Bill not found");
    if (isStale(bill.version, input.expectedVersion)) return resourceModified("bill");

    const [items, paid, bankAccount, customer] = await Promise.all([
      tx.billItem.findMany({ where: { billId: bill.id } }),
      paidSum(tx, bill.id),
      input.bankAccountId
        ? tx.bankAccount.findFirst({ where: { id: input.bankAccountId, businessId } })
        : Promise.resolve(null),
      tx.customer.findFirst({ where: { id: input.customerId, businessId }, select: { id: true, isArchived: true } }),
    ]);
    if (!customer) return fail("NOT_FOUND", "Customer not found");
    // A bill that already belongs to an archived customer / uses an archived bank account may keep it
    // (so old bills stay editable); it may not be switched TO one.
    if (customer.isArchived && input.customerId !== bill.customerId) return fail("CONFLICT", ARCHIVED_CUSTOMER_MESSAGE);
    if (bankAccount?.isArchived && bankAccount.id !== bill.bankAccountId) return fail("CONFLICT", ARCHIVED_BANK_ACCOUNT_MESSAGE);

    if (await billNumberTaken(tx, businessId, input.billNumber, bill.id)) {
      return fail("BILL_NUMBER_TAKEN", BILL_NUMBER_TAKEN_MESSAGE);
    }

    // Editing a bill re-stamps it with the letterhead as Settings has it NOW,
    // so a changed logo, address or GST number reaches the bills the owner
    // reopens. Bills left alone keep whatever they were generated with — the
    // freeze still protects history, an edit is a deliberate re-issue.
    const business = await tx.business.findUniqueOrThrow({ where: { id: businessId } });
    const letterhead = buildLetterhead(business, bankAccount) as object;
    const letterheadChanged = JSON.stringify(letterhead) !== JSON.stringify(bill.letterhead);

    const common = {
      billNumber: input.billNumber,
      billType: input.billType,
      customerId: input.customerId,
      bankAccountId: bankAccount?.id ?? null,
      billDate: new Date(input.billDate),
      gstPercentage: gstRate(input.billType, input.gstPercentage),
      buyerGstin: input.buyerGstin || null,
      notes: input.notes || null,
      showCustomerPhone: input.showCustomerPhone,
      igst: null,
      letterhead,
    } satisfies Prisma.BillUncheckedUpdateInput;

    let money: Prisma.BillUncheckedUpdateInput;
    let total: Decimal;
    let itemsWrite: Omit<Prisma.BillItemUncheckedCreateInput, "billId">[] | null = null;

    if (bill.isDirect) {
      if (!input.excavatorId || !input.fromDate || !input.toDate) {
        return fail("VALIDATION_FAILED", "Select a machine and the period");
      }
      if (Number.isNaN(new Date(input.fromDate).getTime()) || Number.isNaN(new Date(input.toDate).getTime())) {
        return fail("VALIDATION_FAILED", "Enter a valid date");
      }
      const machine = await tx.excavator.findFirst({ where: { id: input.excavatorId, businessId }, select: { id: true } });
      if (!machine) return fail("NOT_FOUND", "Machine not found");

      const amounts = directBillAmounts(input);
      total = amounts.total;
      money = {
        excavatorId: input.excavatorId,
        fromDate: new Date(input.fromDate),
        toDate: new Date(input.toDate),
        bucketHours: amounts.bucketHours,
        bucketRate: amounts.bucketRate,
        breakerHours: amounts.breakerHours,
        breakerRate: amounts.breakerRate,
        dieselLiters: amounts.dieselLiters,
        dieselPricePerLiter: amounts.dieselPricePerLiter,
        dieselAdvance: amounts.dieselAdvance,
        transportCharges: amounts.transportCharges,
        subtotal: amounts.subtotal,
        cgst: amounts.cgst,
        sgst: amounts.sgst,
        totalAmount: amounts.total,
      };
    } else {
      const inputItems = input.items;
      if (!inputItems || inputItems.length === 0) return fail("VALIDATION_FAILED", "A bill needs at least one row");
      const machines = await tx.excavator.findMany({
        where: { businessId, id: { in: inputItems.map((i) => i.excavatorId) } },
        select: { id: true },
      });
      const machineIds = new Set(machines.map((m) => m.id));
      if (inputItems.some((i) => !machineIds.has(i.excavatorId))) {
        return fail("NOT_FOUND", "One of the selected machines was not found");
      }

      const existing = new Map(items.map((i) => [i.id, i]));
      // A work-session link may be carried by exactly one line (database
      // unique index): if a payload repeats a line id, only the first keeps it.
      const linked = new Set<string>();
      const lines = buildSummaryLines(inputItems);
      itemsWrite = lines.map((line, idx) => {
        const lineId = inputItems[idx]?.id;
        const keep = lineId ? existing.get(lineId)?.workSessionId : null;
        const workSessionId = keep && !linked.has(keep) ? keep : null;
        if (workSessionId) linked.add(workSessionId);
        return { ...line, workSessionId };
      });

      const charges = readCharges(input);
      const diesel = readDiesel(input);
      const subtotal = sum(lines.map((l) => l.amount));
      const totals = normalBillTotals(subtotal, charges, input.billType, input.gstPercentage, diesel.dieselAdvance);
      total = totals.total;
      money = {
        ...charges,
        ...diesel,
        subtotal,
        cgst: totals.cgst,
        sgst: totals.sgst,
        totalAmount: totals.total,
      };
    }

    const totalFailure = checkTotal(total);
    if (totalFailure) return totalFailure;
    if (total.lt(paid)) {
      return fail(
        "BILL_TOTAL_BELOW_PAID",
        `The new total (₹${total.toFixed(2)}) is lower than the ₹${paid.toFixed(2)} already paid. Change or remove a payment first.`,
      );
    }

    let updated: Bill;
    try {
      if (itemsWrite) {
        await tx.billItem.deleteMany({ where: { billId: bill.id } });
        await tx.billItem.createMany({ data: itemsWrite.map((i) => ({ ...i, billId: bill.id })) });
      }
      updated = await tx.bill.update({
        where: { id: bill.id },
        data: {
          ...common,
          ...money,
          // Heals any drift of the cached paidAmount as a side effect.
          paidAmount: paid,
          status: paymentStatus(paid, total),
          version: { increment: 1 },
        },
      });
    } catch (error) {
      const failure = uniqueViolation(error);
      if (failure) return failure;
      throw error;
    }

    const afterItems = await tx.billItem.findMany({ where: { billId: bill.id } });
    await recordAudit(tx, {
      businessId,
      actor,
      action: "bill.update",
      entityType: "Bill",
      entityId: bill.id,
      before: billSnapshot(bill, items),
      after: billSnapshot(updated, afterItems),
      reason: input.reason,
      // The snapshots leave the letterhead out, so a re-stamp would otherwise
      // be invisible in the trail.
      details: { billNumber: updated.billNumber, letterheadRefreshed: letterheadChanged },
    });

    return { id: bill.id, version: updated.version } as const;
  });
}

/** Deletes a bill with its lines and payments. Work records it covered
 * become billable again (their bill lines go with it). The audit entry keeps
 * the whole bill, its lines and its payments as the `before` snapshot. */
export async function deleteBill(
  businessId: string,
  actor: AuditActor,
  id: string,
  opts?: { tx?: Tx; expectedVersion?: number; reason?: string },
) {
  return atomic(opts?.tx, async (tx) => {
    const bill = await lockOwnedBill(tx, businessId, id);
    if (!bill) return fail("NOT_FOUND", "Bill not found");
    if (isStale(bill.version, opts?.expectedVersion)) return resourceModified("bill");

    const [items, payments] = await Promise.all([
      tx.billItem.findMany({ where: { billId: bill.id } }),
      tx.payment.findMany({ where: { billId: bill.id }, orderBy: { createdAt: "asc" } }),
    ]);
    await recordAudit(tx, {
      businessId,
      actor,
      action: "bill.delete",
      entityType: "Bill",
      entityId: bill.id,
      before: billSnapshot(bill, items, payments),
      reason: opts?.reason,
      details: { billNumber: bill.billNumber },
    });
    await tx.bill.delete({ where: { id: bill.id } });
    return { success: true } as const;
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** One page of the bills list: newest bill first, `id` as the tie-breaker so
 * the order (and therefore the cursor) is stable. Without `page` a bounded
 * legacy page is returned — never the whole table. */
export type BillListFilters = {
  customerId?: string;
  isDirect?: boolean;
  from?: string;
  to?: string;
  /** Free-text search: bill number, customer, machine, site, or an exact amount. */
  q?: string;
};

/** Server-side search so it covers EVERY bill, not just the page loaded in the
 * browser. Each whitespace-separated word must match somewhere (AND), each word
 * may match any of the searchable fields (OR). */
function searchWhere(q: string | undefined): Prisma.BillWhereInput[] {
  const words = (q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  return words.map((word) => {
    const contains = { contains: word, mode: "insensitive" as const };
    const amount = Number(word.replace(/,/g, ""));
    return {
      OR: [
        { billNumber: contains },
        { customer: { is: { OR: [{ name: contains }, { companyName: contains }] } } },
        { excavator: { is: { OR: [{ name: contains }, { machineNumber: contains }] } } },
        {
          items: {
            some: {
              OR: [{ siteName: contains }, { excavator: { is: { OR: [{ name: contains }, { machineNumber: contains }] } } }],
            },
          },
        },
        ...(Number.isFinite(amount) && word !== "" ? [{ totalAmount: dec(amount) }] : []),
      ],
    };
  });
}

export async function listBills(
  businessId: string,
  filters?: BillListFilters,
  page?: Partial<PageParams>,
) {
  const billDate: { gte?: Date; lte?: Date } = {};
  if (filters?.from) billDate.gte = new Date(filters.from);
  // Bound at end-of-day so a bill dated on the "to" day itself is included.
  if (filters?.to) billDate.lte = new Date(`${filters.to}T23:59:59.999`);

  const limit = page?.limit ?? LEGACY_LIMIT;
  const rows = await db.bill.findMany({
    where: {
      businessId,
      ...(filters?.customerId ? { customerId: filters.customerId } : {}),
      ...(filters?.isDirect !== undefined ? { isDirect: filters.isDirect } : {}),
      ...(Object.keys(billDate).length > 0 ? { billDate } : {}),
      ...(filters?.q?.trim() ? { AND: searchWhere(filters.q) } : {}),
    },
    orderBy: [{ billDate: "desc" }, { id: "desc" }],
    ...pageArgs({ limit, cursor: page?.cursor }),
    include: {
      customer: { select: { name: true, companyName: true } },
      items: { select: { siteName: true, excavator: { select: { name: true, machineNumber: true } } } },
      excavator: { select: { name: true, machineNumber: true } },
    },
  });
  return toPage(rows, limit);
}

export type BillListRow = Awaited<ReturnType<typeof listBills>>["items"][number];

/** Every bill matching the filters, for the register export (follows the cursor internally, capped so a
 * runaway export cannot exhaust memory). `truncated` is true when more bills matched than the cap allowed:
 * the export must SAY so, never silently hand over a partial register. */
export async function listBillsForExport(
  businessId: string,
  filters?: BillListFilters,
  opts: { cap?: number } = {},
): Promise<{ bills: BillListRow[]; truncated: boolean; cap: number }> {
  const cap = opts.cap ?? EXPORT_CAP;
  const all: BillListRow[] = [];
  let cursor: string | undefined;
  let more = false;
  while (all.length < cap) {
    const { items, nextCursor } = await listBills(businessId, filters, { limit: Math.min(200, cap - all.length), cursor });
    all.push(...items);
    more = Boolean(nextCursor);
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return { bills: all, truncated: more, cap };
}

export async function listAllBills(businessId: string, filters?: BillListFilters): Promise<BillListRow[]> {
  return (await listBillsForExport(businessId, filters)).bills;
}

/** Counts backing the All / Generated by App / Self Generated filter pills
 * on the bills list — kept as a separate lightweight query rather than
 * deriving from listBills's result so switching filters doesn't make the
 * pill counts flicker between different totals. */
export async function countBillsByType(businessId: string, customerId?: string) {
  const where = { businessId, ...(customerId ? { customerId } : {}) };
  const [all, app, self] = await Promise.all([
    db.bill.count({ where }),
    db.bill.count({ where: { ...where, isDirect: false } }),
    db.bill.count({ where: { ...where, isDirect: true } }),
  ]);
  return { all, app, self };
}

export async function getBillDetail(businessId: string, id: string) {
  const bill = await db.bill.findFirst({
    where: { id, businessId },
    include: {
      customer: true,
      items: { include: { excavator: { select: { name: true, machineNumber: true } } } },
      excavator: { select: { name: true, machineNumber: true } },
      payments: { orderBy: [{ date: "desc" }, { id: "desc" }] },
    },
  });
  return bill;
}

const toNum = (value: Decimal | null | undefined) => (value == null ? null : value.toNumber());
const toNumOr0 = (value: Decimal) => value.toNumber();

/** Shared by the on-screen/print preview and the Excel export so both
 * always render the exact same bill content. This is the boundary where exact
 * Decimal money becomes plain numbers: BillPreviewData is number-typed because
 * the client, the Excel export and print all consume it. */
export function toBillPreviewData(bill: NonNullable<Awaited<ReturnType<typeof getBillDetail>>>): BillPreviewData {
  return {
    billNumber: bill.billNumber,
    billType: bill.billType,
    billDate: bill.billDate,
    customerName: bill.customer.name,
    customerAddress: bill.customer.address,
    customerMobile: bill.customer.mobile,
    showCustomerPhone: bill.showCustomerPhone,
    buyerGstin: bill.buyerGstin,
    items: bill.items.map((item) => ({
      excavatorName: item.excavator.name,
      machineNumber: item.excavator.machineNumber,
      attachment: item.attachment,
      siteName: item.siteName,
      fromDate: item.fromDate,
      toDate: item.toDate,
      hours: toNumOr0(item.hours),
      ratePerHour: toNumOr0(item.ratePerHour),
      amount: toNumOr0(item.amount),
    })),
    subtotal: toNumOr0(bill.subtotal),
    transportCharges: toNumOr0(bill.transportCharges),
    fuelCharges: toNumOr0(bill.fuelCharges),
    extraCharges: toNumOr0(bill.extraCharges),
    bucketCharge: toNumOr0(bill.bucketCharge),
    breakerCharge: toNumOr0(bill.breakerCharge),
    discount: toNumOr0(bill.discount),
    gstPercentage: toNum(bill.gstPercentage),
    cgst: toNum(bill.cgst),
    sgst: toNum(bill.sgst),
    igst: toNum(bill.igst),
    totalAmount: toNumOr0(bill.totalAmount),
    notes: bill.notes,
    letterhead: bill.letterhead as unknown as BillLetterhead,
    isDirect: bill.isDirect,
    excavatorName: bill.excavator?.name,
    machineNumber: bill.excavator?.machineNumber,
    fromDate: bill.fromDate,
    toDate: bill.toDate,
    bucketHours: toNum(bill.bucketHours),
    bucketRate: toNum(bill.bucketRate),
    breakerHours: toNum(bill.breakerHours),
    breakerRate: toNum(bill.breakerRate),
    dieselLiters: toNum(bill.dieselLiters),
    dieselPricePerLiter: toNum(bill.dieselPricePerLiter),
    dieselAdvance: toNum(bill.dieselAdvance),
  };
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/** The pending balance as the human-readable part of PAYMENT_EXCEEDS_BALANCE. */
function exceedsBalance(remaining: Decimal) {
  const shown = remaining.lt(0) ? ZERO : remaining;
  return fail("PAYMENT_EXCEEDS_BALANCE", `Amount exceeds the pending balance of ₹${shown.toFixed(2)}`);
}

/** Records a payment. Under a row lock on the bill: re-read what has been
 * paid so far (the exact sum of Payment rows), refuse anything beyond the
 * balance (PAYMENT_EXCEEDS_BALANCE), then write the payment and the bill's
 * paidAmount/status/version together — so any number of parallel requests can
 * never over-collect a bill. */
export async function addPayment(
  businessId: string,
  actor: AuditActor,
  input: { billId: string; amount: number; date: string; method?: string; notes?: string },
  opts?: { tx?: Tx },
) {
  return atomic(opts?.tx, async (tx) => {
    const bill = await lockOwnedBill(tx, businessId, input.billId);
    if (!bill) return fail("NOT_FOUND", "Bill not found");

    const amount = round2(input.amount);
    if (amount.lte(0)) return fail("VALIDATION_FAILED", "Enter an amount greater than 0");

    const paidBefore = await paidSum(tx, bill.id);
    const remaining = bill.totalAmount.minus(paidBefore);
    if (amount.gt(remaining)) return exceedsBalance(remaining);

    const paidAfter = paidBefore.plus(amount);
    const payment = await tx.payment.create({
      data: {
        businessId,
        billId: bill.id,
        amount,
        date: new Date(input.date),
        method: input.method || null,
        notes: input.notes || null,
      },
    });
    const updated = await tx.bill.update({
      where: { id: bill.id },
      data: {
        paidAmount: paidAfter,
        status: paymentStatus(paidAfter, bill.totalAmount),
        version: { increment: 1 },
      },
      select: { id: true, paidAmount: true, status: true, version: true },
    });

    await recordAudit(tx, {
      businessId,
      actor,
      action: "payment.create",
      entityType: "Payment",
      entityId: payment.id,
      after: payment,
      details: { billId: bill.id, billNumber: bill.billNumber, paidBefore, paidAfter, status: updated.status },
    });

    return { success: true, payment, bill: updated } as const;
  });
}

/** Admin corrects a recorded payment (amount/date/method/notes). The sum of
 * all payments must still fit within the bill total (PAYMENT_EXCEEDS_BALANCE). */
export async function updatePayment(
  businessId: string,
  actor: AuditActor,
  input: {
    billId: string;
    paymentId: string;
    amount: number;
    date: string;
    method?: string;
    notes?: string;
    expectedVersion?: number;
    reason?: string;
  },
  opts?: { tx?: Tx },
) {
  return atomic(opts?.tx, async (tx) => {
    const bill = await lockOwnedBill(tx, businessId, input.billId);
    if (!bill) return fail("NOT_FOUND", "Payment not found");
    const payment = await tx.payment.findFirst({ where: { id: input.paymentId, billId: bill.id, businessId } });
    if (!payment) return fail("NOT_FOUND", "Payment not found");
    if (isStale(payment.version, input.expectedVersion)) return resourceModified("payment");

    const amount = round2(input.amount);
    if (amount.lte(0)) return fail("VALIDATION_FAILED", "Enter an amount greater than 0");

    const others = await paidSum(tx, bill.id, payment.id);
    const room = bill.totalAmount.minus(others);
    if (amount.gt(room)) return exceedsBalance(room);

    const paidAfter = others.plus(amount);
    const updatedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        amount,
        date: new Date(input.date),
        method: input.method || null,
        notes: input.notes || null,
        version: { increment: 1 },
      },
    });
    const updatedBill = await tx.bill.update({
      where: { id: bill.id },
      data: {
        paidAmount: paidAfter,
        status: paymentStatus(paidAfter, bill.totalAmount),
        version: { increment: 1 },
      },
      select: { id: true, paidAmount: true, status: true, version: true },
    });

    await recordAudit(tx, {
      businessId,
      actor,
      action: "payment.update",
      entityType: "Payment",
      entityId: payment.id,
      before: payment,
      after: updatedPayment,
      reason: input.reason,
      details: { billId: bill.id, billNumber: bill.billNumber, paidAfter, status: updatedBill.status },
    });

    return { success: true, payment: updatedPayment, bill: updatedBill } as const;
  });
}

export async function deletePayment(
  businessId: string,
  actor: AuditActor,
  billId: string,
  paymentId: string,
  opts?: { tx?: Tx; expectedVersion?: number; reason?: string },
) {
  return atomic(opts?.tx, async (tx) => {
    const bill = await lockOwnedBill(tx, businessId, billId);
    if (!bill) return fail("NOT_FOUND", "Payment not found");
    const payment = await tx.payment.findFirst({ where: { id: paymentId, billId: bill.id, businessId } });
    if (!payment) return fail("NOT_FOUND", "Payment not found");
    if (isStale(payment.version, opts?.expectedVersion)) return resourceModified("payment");

    await tx.payment.delete({ where: { id: payment.id } });
    const paidAfter = await paidSum(tx, bill.id);
    const updatedBill = await tx.bill.update({
      where: { id: bill.id },
      data: {
        paidAmount: paidAfter,
        status: paymentStatus(paidAfter, bill.totalAmount),
        version: { increment: 1 },
      },
      select: { id: true, paidAmount: true, status: true, version: true },
    });

    await recordAudit(tx, {
      businessId,
      actor,
      action: "payment.delete",
      entityType: "Payment",
      entityId: payment.id,
      before: payment,
      reason: opts?.reason,
      details: { billId: bill.id, billNumber: bill.billNumber, paidAfter, status: updatedBill.status },
    });

    return { success: true, bill: updatedBill } as const;
  });
}
