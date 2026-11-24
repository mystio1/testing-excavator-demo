import { z } from "zod";

/** Upper bound on rows in one bill (a month of daily rows for ~30 machines). Bounds the work a single
 * request can make the server do; Quick Fill itself caps at 62 days per machine. */
export const MAX_BILL_ROWS = 1000;
import { ApiHttpError } from "@/lib/api-error";

/** Upper bounds keep every accepted value inside its NUMERIC column (money
 * NUMERIC(14,2), hours NUMERIC(10,2)) so an oversized number is a clean 422
 * instead of a database overflow. The service additionally bounds the total. */
export const MAX_MONEY = 100_000_000;
export const MAX_HOURS = 100_000;

/** Non-negative money input. Stays a coerced number (the service converts it
 * to an exact Decimal before any arithmetic). */
const money = (message?: string) => z.coerce.number().min(0, message).max(MAX_MONEY, "That amount is too large");
const hours = (message?: string) => z.coerce.number().min(0, message).max(MAX_HOURS, "That many hours is too large");

/** A non-empty string that actually parses as a date — an unparsable value
 * used to reach Prisma and surface as a 500. */
const dateField = (emptyMessage?: string) =>
  z
    .string()
    .min(1, emptyMessage)
    .refine((v) => !Number.isNaN(new Date(v).getTime()), "Enter a valid date");

/** Diesel the customer supplied. It is an advance against the bill, not a
 * charge, so litres x price comes OFF the total — unless the owner turns the
 * deduction off, in which case the figures are still recorded but not applied. */
const dieselFields = {
  dieselLiters: hours().default(0),
  dieselPricePerLiter: money().default(0),
  deductDiesel: z.boolean().default(true),
};

export const generateBillSchema = z
  .object({
    customerId: z.string().min(1),
    workSessionIds: z.array(z.string().min(1)).min(1, "Select at least one work record").max(MAX_BILL_ROWS, `A bill can have at most ${MAX_BILL_ROWS} rows`),
    attachment: z.string().trim().optional(),
    /** Site name to print on every line; blank = each work record's own site. */
    siteName: z.string().trim().max(200, "Site name is too long").optional(),
    billDate: dateField(),
    ratePerHour: money("Must be 0 or more"),
    transportCharges: money().default(0),
    fuelCharges: money().default(0),
    extraCharges: money().default(0),
    bucketCharge: money().default(0),
    breakerCharge: money().default(0),
    discount: money().default(0),
    ...dieselFields,
    billType: z.enum(["GST", "NON_GST"]),
    billNumber: z.string().trim().optional(),
    gstPercentage: z.coerce.number().min(0).max(28).optional(),
    buyerGstin: z.string().trim().optional(),
    bankAccountId: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    showCustomerPhone: z.boolean().default(true),
  })
  .refine((data) => data.billType !== "GST" || !!data.billNumber, {
    message: "Enter a GST bill number",
    path: ["billNumber"],
  })
  .refine((data) => data.billType !== "GST" || data.gstPercentage != null, {
    message: "Select a GST rate",
    path: ["gstPercentage"],
  });

export type GenerateBillInput = z.infer<typeof generateBillSchema>;

const chargeFields = {
  transportCharges: money().default(0),
  fuelCharges: money().default(0),
  extraCharges: money().default(0),
  bucketCharge: money().default(0),
  breakerCharge: money().default(0),
  discount: money().default(0),
};

/** One line of a bill typed in by hand (Summary Bill / bill edit). `id` is
 * only present when editing an existing line, so its link back to the
 * underlying WorkSession (if any) survives the edit. */
export const billItemInputSchema = z
  .object({
    id: z.string().optional(),
    excavatorId: z.string().min(1, "Select a machine on every row"),
    siteName: z.string().trim().min(1, "Enter a site on every row"),
    attachment: z.string().trim().optional(),
    fromDate: dateField("Enter a date on every row"),
    toDate: dateField("Enter a date on every row"),
    hours: hours("Hours must be 0 or more"),
    ratePerHour: money("Rate must be 0 or more"),
  })
  .refine((i) => new Date(i.toDate) >= new Date(i.fromDate), {
    message: "A row's end date is before its start date",
  });

export type BillItemInput = z.infer<typeof billItemInputSchema>;

/** Summary Bill — a normal (non-direct) bill whose lines are typed in
 * directly, so no logged WorkSessions are needed. */
export const generateSummaryBillSchema = z
  .object({
    customerId: z.string().min(1),
    billDate: dateField(),
    items: z.array(billItemInputSchema).min(1, "Add at least one row").max(MAX_BILL_ROWS, `A bill can have at most ${MAX_BILL_ROWS} rows`),
    ...chargeFields,
    ...dieselFields,
    billType: z.enum(["GST", "NON_GST"]),
    billNumber: z.string().trim().optional(),
    gstPercentage: z.coerce.number().min(0).max(28).optional(),
    buyerGstin: z.string().trim().optional(),
    bankAccountId: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    showCustomerPhone: z.boolean().default(true),
  })
  .refine((data) => data.billType !== "GST" || !!data.billNumber, {
    message: "Enter a GST bill number",
    path: ["billNumber"],
  })
  .refine((data) => data.billType !== "GST" || data.gstPercentage != null, {
    message: "Select a GST rate",
    path: ["gstPercentage"],
  });

export type GenerateSummaryBillInput = z.infer<typeof generateSummaryBillSchema>;

/** Admin edit of an already-generated bill — everything can change. Normal /
 * summary bills send `items`; direct bills send the direct-bill fields.
 *
 * `expectedVersion` is the `version` of the bill the form was loaded from
 * (optimistic concurrency — omitted by older installed apps, which skips the
 * check). `reason` is stored on the audit entry. */
export const updateBillSchema = z
  .object({
    customerId: z.string().min(1),
    billDate: dateField(),
    billNumber: z.string().trim().min(1, "Enter a bill number"),
    items: z.array(billItemInputSchema).max(MAX_BILL_ROWS, `A bill can have at most ${MAX_BILL_ROWS} rows`).optional(),
    ...chargeFields,
    ...dieselFields,
    billType: z.enum(["GST", "NON_GST"]),
    gstPercentage: z.coerce.number().min(0).max(28).optional(),
    buyerGstin: z.string().trim().optional(),
    bankAccountId: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    showCustomerPhone: z.boolean().default(true),
    // Direct-bill-only fields
    excavatorId: z.string().optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
    bucketHours: hours().default(0),
    bucketRate: money().default(0),
    breakerHours: hours().default(0),
    breakerRate: money().default(0),
    expectedVersion: z.number().int().min(0).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((data) => data.billType !== "GST" || data.gstPercentage != null, {
    message: "Select a GST rate",
    path: ["gstPercentage"],
  });

export type UpdateBillInput = z.infer<typeof updateBillSchema>;

/** A payment can be any positive amount down to one paisa (the last rupee of a
 * balance like ₹33,849.40 is a legitimate payment). */
const paymentAmount = z.coerce
  .number()
  .min(0.01, "Enter an amount greater than 0")
  .max(999_999_999_999, "That amount is too large");

export const addPaymentSchema = z.object({
  billId: z.string().min(1),
  amount: paymentAmount,
  date: dateField(),
  method: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export type AddPaymentInput = z.infer<typeof addPaymentSchema>;

export const updatePaymentSchema = z.object({
  amount: paymentAmount,
  date: dateField(),
  method: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  expectedVersion: z.number().int().min(0).optional(),
  reason: z.string().trim().max(500).optional(),
});

export type UpdatePaymentInput = z.infer<typeof updatePaymentSchema>;

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must look like YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Not a valid date");

/** Query string of GET /api/bills/export. Unvalidated `from`/`to` used to reach Date parsing and Prisma. */
export const billsExportQuerySchema = z.object({
  customerId: z.string().min(1).max(64).optional(),
  filter: z.enum(["app", "self"]).optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  // Longer text is cut, not rejected (the UI search box is unbounded; the old route silently sliced too).
  q: z.string().trim().transform((v) => v.slice(0, 100)).optional(),
});

/** DELETE requests carry no body, so the version the client loaded travels as
 * `?expectedVersion=3`. Absent (older apps) → no check. */
export function parseExpectedVersion(req: Request): number | undefined {
  const raw = new URL(req.url).searchParams.get("expectedVersion");
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new ApiHttpError("BAD_REQUEST", "expectedVersion must be a non-negative integer");
  return n;
}
