import { db } from "@/lib/db";
import { createSite } from "@/lib/services/sites";
import type { TestTenant } from "../helpers/tenant";

/**
 * The owner's scenario: Customer Site "XYZ Construction Site" for customer "ABC Construction",
 * three machines, Bucket Rs 1,200/h and Brekar Rs 1,500/h, approved daily logs totalling
 * 390 bucket hours + 96.5 breaker hours = 486.5 h, revenue 4,68,000 + 1,44,750 = 6,12,750.
 */

export type LogSpec = { date: string; hours: number; attachment: string | null; diesel?: number };

export const MACHINES = [
  {
    key: "pc200",
    name: "Komatsu PC200",
    number: "PC200-1",
    operator: "Ramesh",
    logs: [
      ...Array.from({ length: 10 }, (_, i): LogSpec => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, hours: 15, attachment: "Bucket", diesel: 40 })),
      ...Array.from({ length: 4 }, (_, i): LogSpec => ({ date: `2026-09-${String(i + 11).padStart(2, "0")}`, hours: 10, attachment: "Breaker", diesel: 30 })),
    ],
  },
  {
    key: "jcb",
    name: "JCB 3DX",
    number: "JCB-1",
    operator: "Suresh",
    logs: [
      ...Array.from({ length: 7 }, (_, i): LogSpec => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, hours: 20, attachment: "Bucket", diesel: 45 })),
      { date: "2026-09-08", hours: 10, attachment: "Breaker", diesel: 25 },
      { date: "2026-09-09", hours: 10, attachment: "Breaker", diesel: 25 },
      { date: "2026-09-10", hours: 10.5, attachment: "Breaker", diesel: 26.5 },
    ],
  },
  {
    key: "pc210",
    name: "Komatsu PC210",
    number: "PC210-1",
    operator: "Amit",
    logs: [
      ...Array.from({ length: 5 }, (_, i): LogSpec => ({ date: `2026-09-${String(i + 3).padStart(2, "0")}`, hours: 20, attachment: "Bucket", diesel: 50 })),
      { date: "2026-09-08", hours: 13, attachment: "Breaker", diesel: 30 },
      { date: "2026-09-09", hours: 13, attachment: "Breaker", diesel: 30 },
    ],
  },
] as const;

export const BUCKET_RATE = 1200;
export const BREAKER_RATE = 1500;

export type Scenario = {
  customerId: string;
  siteId: string;
  machines: { key: string; name: string; excavatorId: string; operatorId: string; sessionId: string; logs: readonly LogSpec[] }[];
  /** Approved DIESEL_ONLY entry added on top (20 L, 0 hours). */
  dieselOnlyLitres: number;
};

export async function buildScenario(t: TestTenant): Promise<Scenario> {
  const customer = await db.customer.create({ data: { businessId: t.businessId, name: "ABC Construction", mobile: "9555555555" } });
  const created = await createSite(t.businessId, t.actor, {
    name: "XYZ Construction Site",
    type: "CUSTOMER_SITE",
    customerId: customer.id,
    address: "Kharadi, Pune",
    status: "ACTIVE",
    bucketRate: BUCKET_RATE,
    breakerRate: BREAKER_RATE,
  });
  if ("error" in created) throw new Error(created.error);
  const siteId = created.site.id;

  const machines: Scenario["machines"] = [];
  for (const m of MACHINES) {
    const [excavator, operator] = await Promise.all([
      db.excavator.create({ data: { businessId: t.businessId, name: m.name, machineNumber: m.number } }),
      db.operator.create({ data: { businessId: t.businessId, name: m.operator, mobile: `98${Math.floor(Math.random() * 1e8)}` } }),
    ]);
    // Widened before the fold: each machine's `logs` is a different array
    // literal, so `reduce` on the union resolved to an overload that typed the
    // accumulator as a LogSpec and made `total` unusable as a number.
    const logs: readonly LogSpec[] = m.logs;
    const total = logs.reduce((a, l) => a + l.hours, 0);
    const session = await db.workSession.create({
      data: {
        businessId: t.businessId,
        excavatorId: excavator.id,
        customerId: customer.id,
        siteId,
        operatorId: operator.id,
        startDate: new Date("2026-09-01"),
        endDate: new Date("2026-09-14"),
        startHourMeter: 1000,
        endHourMeter: 1000 + total,
        totalHours: total,
        attachment: "Breaker",
        status: "COMPLETED",
      },
    });
    let meter = 1000;
    for (const l of m.logs) {
      await db.dailyWorkLog.create({
        data: {
          workSessionId: session.id,
          date: new Date(l.date),
          startHourMeter: meter,
          endHourMeter: meter + l.hours,
          hoursWorked: l.hours,
          attachment: l.attachment,
          dieselLiters: l.diesel ?? null,
          status: "APPROVED",
        },
      });
      meter += l.hours;
    }
    machines.push({ key: m.key, name: m.name, excavatorId: excavator.id, operatorId: operator.id, sessionId: session.id, logs: m.logs });
  }

  // Noise that must NOT count: a PENDING and a REJECTED log (bucket, big hours), and an approved diesel-only entry (counts litres only).
  const first = machines[0];
  await db.dailyWorkLog.createMany({
    data: [
      { workSessionId: first.sessionId, date: new Date("2026-09-20"), hoursWorked: 99, attachment: "Bucket", dieselLiters: 99, status: "PENDING" },
      { workSessionId: first.sessionId, date: new Date("2026-09-21"), hoursWorked: 77, attachment: "Bucket", dieselLiters: 77, status: "REJECTED" },
      { workSessionId: first.sessionId, date: new Date("2026-09-15"), hoursWorked: 0, kind: "DIESEL_ONLY", dieselLiters: 20, notes: "Top-up", status: "APPROVED" },
    ],
  });
  return { customerId: customer.id, siteId, machines, dieselOnlyLitres: 20 };
}

export const sumHours = (logs: readonly LogSpec[], attachment?: string) =>
  Math.round(logs.filter((l) => !attachment || l.attachment === attachment).reduce((a, l) => a + l.hours, 0) * 100) / 100;
export const sumDiesel = (logs: readonly LogSpec[]) => Math.round(logs.reduce((a, l) => a + (l.diesel ?? 0), 0) * 100) / 100;
