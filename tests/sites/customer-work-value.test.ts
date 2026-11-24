import "../bills/pool";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { countWorkingDays, getCustomerDetail, listCustomers } from "@/lib/services/customers";
import { createBill } from "@/lib/services/bills";
import { generateBillSchema } from "@/lib/validation/bill";
import { cleanupTenant, createTenant, type TestTenant } from "../helpers/tenant";
import { BREAKER_RATE, BUCKET_RATE, buildScenario, type Scenario } from "./fixture";

/**
 * A customer with recorded but unbilled trips must not show Rs 0: their total and pending
 * include that work valued site by site at the site's rates (the same figure Site Analysis shows).
 */

let t: TestTenant;
let sc: Scenario;

beforeAll(async () => {
  t = await createTenant("customer-work-value");
  sc = await buildScenario(t);
});

afterAll(async () => {
  if (t) await cleanupTenant(t.businessId);
  await db.$disconnect();
});

describe("customer amount from site rates", () => {
  it("detail: total and pending = unbilled hours x site rate, broken down site wise", async () => {
    const d = (await getCustomerDetail(t.businessId, sc.customerId))!;
    expect(d.totalRevenue).toBe(612750);
    expect(d.pending).toBe(612750);
    expect(d.billedAmount).toBe(0);
    expect(d.unbilledAmount).toBe(612750);
    expect(d.unbilledWork).toEqual([
      { siteId: sc.siteId, siteName: "XYZ Construction Site", workType: "BREAKER", hours: 96.5, rate: BREAKER_RATE, amount: 144750 },
      { siteId: sc.siteId, siteName: "XYZ Construction Site", workType: "BUCKET", hours: 390, rate: BUCKET_RATE, amount: 468000 },
    ]);
  });

  it("list: the customer row and the summary carry the same figure", async () => {
    const { customers, summary } = await listCustomers(t.businessId);
    const row = customers.find((c) => c.id === sc.customerId)!;
    expect(row.totalRevenue).toBe(612750);
    expect(row.pending).toBe(612750);
    expect(summary).toMatchObject({ totalRevenue: 612750, pendingPayments: 612750, withPendingDues: 1 });
  });

  it("billing work moves it from unbilled to billed without counting it twice", async () => {
    const m = sc.machines[0];
    await createBill(
      t.businessId,
      t.actor,
      generateBillSchema.parse({
        customerId: sc.customerId,
        workSessionIds: [m.sessionId],
        billDate: "2026-10-02",
        ratePerHour: 1000,
        billType: "NON_GST",
        siteName: "Kharadi Plot 7",
      }),
    );
    const item = await db.billItem.findFirstOrThrow({ where: { workSessionId: m.sessionId } });
    expect(item.siteName).toBe("Kharadi Plot 7"); // the name typed on the bill, not the site record's

    const d = (await getCustomerDetail(t.businessId, sc.customerId))!;
    const billed = Number(item.amount);
    const pc200Value = 150 * BUCKET_RATE + 40 * BREAKER_RATE; // its unbilled value before billing
    expect(d.billedAmount).toBe(billed);
    expect(d.unbilledAmount).toBe(612750 - pc200Value);
    expect(d.totalRevenue).toBe(billed + 612750 - pc200Value);
  });
});

describe("working days", () => {
  it("counts reading days, and every day of a job without readings from its first day", () => {
    const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
    const n = countWorkingDays(
      [
        // readings: 2 work days; rejected and diesel-only days do not count
        {
          startDate: day("2026-11-01"),
          endDate: day("2026-11-05"),
          status: "COMPLETED",
          dailyLogs: [
            { date: day("2026-11-01"), status: "APPROVED", hoursWorked: 8 },
            { date: day("2026-11-02"), status: "PENDING", hoursWorked: 6 },
            { date: day("2026-11-03"), status: "REJECTED", hoursWorked: 9 },
            { date: day("2026-11-04"), status: "APPROVED", hoursWorked: 0 },
          ],
        },
        // operator start/end job with no readings: 10th to 12th = 3 days
        { startDate: day("2026-11-10"), endDate: day("2026-11-12"), status: "COMPLETED", dailyLogs: [] },
        // overlapping second machine on the 12th adds nothing new
        { startDate: day("2026-11-12"), endDate: day("2026-11-12"), status: "COMPLETED", dailyLogs: [] },
        // still running: from the 18th up to today (the 20th) = 3 days
        { startDate: day("2026-11-18"), endDate: null, status: "ACTIVE", dailyLogs: [] },
      ],
      day("2026-11-20"),
    );
    expect(n).toBe(2 + 3 + 3);
  });

  it("the customer page reports it (scenario: readings on 1-14 Sep, plus a pending reading on the 20th)", async () => {
    const d = (await getCustomerDetail(t.businessId, sc.customerId))!;
    expect(d.totalWorkingDays).toBe(15);
  });
});
