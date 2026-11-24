import "../bills/pool";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getMachineEarnings, getSiteAnalysis } from "@/lib/services/siteAnalysis";
import { cleanupTenant, createTenant, type TestTenant } from "../helpers/tenant";
import { BREAKER_RATE, BUCKET_RATE, buildScenario, sumHours, type Scenario } from "./fixture";

/** Machine Performance uses the Site Analysis valuation, grouped by period. */

let t: TestTenant;
let sc: Scenario;
let unratedSiteId: string;

beforeAll(async () => {
  t = await createTenant("machine-earnings");
  sc = await buildScenario(t);

  // A site with NO rates: 8 h of Bucket work on the first machine in October.
  const site = await db.site.create({ data: { businessId: t.businessId, name: "No Rate Site" } });
  unratedSiteId = site.id;
  const m = sc.machines[0];
  const session = await db.workSession.create({
    data: {
      businessId: t.businessId,
      excavatorId: m.excavatorId,
      customerId: sc.customerId,
      siteId: site.id,
      operatorId: m.operatorId,
      startDate: new Date("2026-10-05"),
      endDate: new Date("2026-10-05"),
      startHourMeter: 5000,
      endHourMeter: 5008,
      totalHours: 8,
      attachment: "Bucket",
      status: "COMPLETED",
    },
  });
  await db.dailyWorkLog.create({
    data: {
      workSessionId: session.id,
      date: new Date("2026-10-05"),
      startHourMeter: 5000,
      endHourMeter: 5008,
      hoursWorked: 8,
      attachment: "Bucket",
      status: "APPROVED",
    },
  });
});

afterAll(async () => {
  if (t) await cleanupTenant(t.businessId);
  await db.$disconnect();
});

const revenueOf = (logs: Scenario["machines"][number]["logs"]) =>
  sumHours(logs, "Bucket") * BUCKET_RATE + sumHours(logs, "Breaker") * BREAKER_RATE;

describe("machine earnings", () => {
  it("monthly: each machine's September revenue is its hours x site rate, and the fleet matches Site Analysis", async () => {
    const e = await getMachineEarnings(t.businessId, "month", "2026-10-20");
    expect(e.buckets).toHaveLength(12);
    expect(e.buckets.at(-1)).toEqual({ key: "2026-10-01", start: "2026-10-01", end: "2026-10-31" });
    const sepIndex = e.buckets.findIndex((b) => b.key === "2026-09-01");
    expect(e.buckets[sepIndex].end).toBe("2026-09-30");

    for (const m of sc.machines) {
      const row = e.machines.find((x) => x.id === m.excavatorId)!;
      expect(row.series[sepIndex].revenue).toBe(revenueOf(m.logs));
      expect(row.series[sepIndex].hours).toBe(sumHours(m.logs));
    }
    const fleetSep = e.machines.reduce((a, m) => a + m.series[sepIndex].revenue, 0);
    const site = (await getSiteAnalysis(t.businessId, sc.siteId))!;
    expect(fleetSep).toBe(site.summary.revenue);
    expect(fleetSep).toBe(612750);
  });

  it("work at a site with no rate is ₹0, counted as unpriced hours, and the site is reported", async () => {
    const e = await getMachineEarnings(t.businessId, "month", "2026-10-20");
    const first = e.machines.find((x) => x.id === sc.machines[0].excavatorId)!;
    const oct = first.series.at(-1)!;
    expect(oct).toMatchObject({ revenue: 0, hours: 8, unpricedHours: 8 });
    expect(e.missingRateSites).toEqual([{ id: unratedSiteId, name: "No Rate Site", missing: ["Bucket"], hours: 8 }]);
  });

  it("daily, weekly and yearly views split the same work into their own periods", async () => {
    const day = await getMachineEarnings(t.businessId, "day", "2026-09-03");
    expect(day.buckets.map((b) => b.key)).toEqual([
      "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03",
    ]);
    const pc200 = day.machines.find((x) => x.id === sc.machines[0].excavatorId)!;
    expect(pc200.series.at(-1)).toMatchObject({ hours: 15, revenue: 15 * BUCKET_RATE });

    // 2026-09-03 is a Thursday: its week starts Monday 31 Aug.
    const week = await getMachineEarnings(t.businessId, "week", "2026-09-03");
    expect(week.buckets.at(-1)).toMatchObject({ start: "2026-08-31", end: "2026-09-06" });

    const year = await getMachineEarnings(t.businessId, "year", "2026-10-20");
    expect(year.buckets.map((b) => b.key)).toEqual(["2022-01-01", "2023-01-01", "2024-01-01", "2025-01-01", "2026-01-01"]);
    const total = year.machines.reduce((a, m) => a + m.series.at(-1)!.revenue, 0);
    expect(total).toBe(612750); // the unrated October work adds nothing until its rate is set
    expect(year.missingRateSites.map((s) => s.id)).toEqual([unratedSiteId]);
  });
});
