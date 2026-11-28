import { db } from "@/lib/db";
import { listCustomers } from "@/lib/services/customers";
import { listExcavators } from "@/lib/services/excavators";
import { listOperators } from "@/lib/services/operators";
import { getLifetimeSalaryBreakdown } from "@/lib/services/salary";
import { listSites } from "@/lib/services/siteAnalysis";
import type { MachineRecord } from "./machines";

/**
 * The real figures behind a list screen, for answering questions about it.
 *
 * A read used to be answered from the page's visible text, cut to 1,200
 * characters. On the Customers page that is the summary cards and the first
 * customer or two, in alphabetical order. Measured, from a real owner: asked
 * "which customer has the most payment pending?", it answered "four of five
 * customers have payments pending" — the summary card, because the rows that
 * held the answer had been cut off, and they were not sorted by what was owed
 * anyway.
 *
 * So each list read is given its rows from the same services the screens use,
 * already sorted by the thing people ask about (most owed first), as compact
 * lines. The screen text still follows, but the answer no longer depends on
 * which rows happened to fit.
 *
 * Every value here is the owner's own data, and the names in it were typed by
 * people. It is passed inside the same fenced, "this is data" block as the
 * screen text, never as instructions.
 */

const MAX_ROWS = 15;

export const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// --- pure formatters (tested without a database) ------------------------------

export function formatCustomers(rows: { name: string; companyName?: string | null; totalRevenue: number; pending: number; tripCount?: number }[]): string {
  const owing = rows.filter((r) => r.pending > 0.01).sort((a, b) => b.pending - a.pending);
  const total = owing.reduce((a, r) => a + r.pending, 0);
  const lines = owing.slice(0, MAX_ROWS).map(
    (r, i) =>
      `${i + 1}. ${r.name}${r.companyName ? ` (${r.companyName})` : ""} — owes ${rupees(r.pending)} of ${rupees(r.totalRevenue)}`,
  );
  return [
    `CUSTOMERS, most owed first. "Owes" = unpaid bills + approved work not billed yet.`,
    `${owing.length} of ${rows.length} customers owe money; together ${rupees(total)}.`,
    ...(lines.length ? lines : ["No customer owes anything."]),
    ...(owing.length > MAX_ROWS ? [`(${owing.length - MAX_ROWS} more not listed)`] : []),
  ].join("\n");
}

export function formatBills(rows: { billNumber: string; customer: string; billDate: Date; total: number; paid: number }[]): string {
  const unpaid = rows
    .map((r) => ({ ...r, pending: Math.round((r.total - r.paid) * 100) / 100 }))
    .filter((r) => r.pending > 0.01)
    .sort((a, b) => b.pending - a.pending);
  const total = unpaid.reduce((a, r) => a + r.pending, 0);
  return [
    `UNPAID BILLS, largest balance first.`,
    `${unpaid.length} bills not fully paid; balance due ${rupees(total)}.`,
    ...unpaid
      .slice(0, MAX_ROWS)
      .map(
        (r, i) =>
          `${i + 1}. ${r.billNumber} — ${r.customer} — dated ${r.billDate.toISOString().slice(0, 10)} — total ${rupees(r.total)}, paid ${rupees(r.paid)}, due ${rupees(r.pending)}`,
      ),
  ].join("\n");
}

export function formatMachines(rows: (MachineRecord & { currentHourMeter: number; customer: string | null })[]): string {
  return [
    `MACHINES (${rows.length}).`,
    ...rows.map(
      (m) =>
        `- ${[m.name, m.machineNumber].filter(Boolean).join(" ")}: ${m.status === "WORKING" ? "working" : m.status === "IDLE" ? "idle" : m.status.toLowerCase()}` +
        `${m.customer ? ` for ${m.customer}` : ""}` +
        `, site ${m.site ?? "none"}, operator ${m.operator ?? "none"}, hour meter ${m.currentHourMeter}`,
    ),
  ].join("\n");
}

export function formatOperators(rows: { name: string; machine: string | null; remaining: number | null }[]): string {
  const sorted = [...rows].sort((a, b) => (b.remaining ?? 0) - (a.remaining ?? 0));
  return [
    `OPERATORS, most salary owed first. "Owed" = salary earned + bonus − deductions − paid, to today.`,
    ...sorted.map(
      (o) =>
        `- ${o.name}: machine ${o.machine ?? "none"}, ` +
        (o.remaining == null ? "salary not known" : o.remaining >= 0 ? `owed ${rupees(o.remaining)}` : `overpaid ${rupees(-o.remaining)}`),
    ),
  ].join("\n");
}

export function formatSites(rows: { name: string; customerName: string; status: string; totalHours: number; revenue: number; received: number; pending: number }[]): string {
  const sorted = [...rows].sort((a, b) => b.pending - a.pending);
  return [
    `SITES, most pending first. Values are approved work (billed at bill amount, unbilled at site rate).`,
    ...sorted
      .slice(0, MAX_ROWS)
      .map(
        (s, i) =>
          `${i + 1}. ${s.name} (${s.customerName}, ${s.status.toLowerCase()}) — ${s.totalHours} h, value ${rupees(s.revenue)}, received ${rupees(s.received)}, pending ${rupees(s.pending)}`,
      ),
  ].join("\n");
}

// --- loaders ------------------------------------------------------------------

/** Machines in the shape identifyMachine() needs. */
export async function loadMachines(businessId: string): Promise<MachineRecord[]> {
  const rows = await listExcavators(businessId);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    machineNumber: r.machineNumber,
    operator: r.assignedOperator,
    site: r.currentSite,
    status: r.status,
    // An owner-started job is the one a reading or a stop can be added to.
    hasActiveJob: r.currentCustomer != null,
  }));
}

/**
 * The figures for the list a read workflow opened, or null when it has none
 * (single-record reads are answered from their own detail page, which fits).
 * Never throws: an answer from the screen alone is still an answer.
 */
export async function readFacts(workflowId: string, businessId: string): Promise<string | null> {
  try {
    switch (workflowId) {
      case "customer.list": {
        const { customers } = await listCustomers(businessId, undefined, undefined, { limit: 200, cursor: undefined });
        return formatCustomers(customers);
      }
      case "bill.list": {
        const bills = await db.bill.findMany({
          where: { businessId, status: { in: ["UNPAID", "PARTIAL"] } },
          select: { billNumber: true, billDate: true, totalAmount: true, paidAmount: true, customer: { select: { name: true } } },
          take: 500,
        });
        return formatBills(
          bills.map((b) => ({
            billNumber: b.billNumber,
            customer: b.customer.name,
            billDate: b.billDate,
            total: Number(b.totalAmount),
            paid: Number(b.paidAmount),
          })),
        );
      }
      case "machine.list": {
        const rows = await listExcavators(businessId);
        return formatMachines(
          rows.map((r) => ({
            id: r.id,
            name: r.name,
            machineNumber: r.machineNumber,
            operator: r.assignedOperator,
            site: r.currentSite,
            status: r.status,
            hasActiveJob: r.currentCustomer != null,
            currentHourMeter: r.currentHourMeter,
            customer: r.currentCustomer,
          })),
        );
      }
      case "operator.list": {
        const [operators, salary] = await Promise.all([listOperators(businessId), getLifetimeSalaryBreakdown(businessId)]);
        const due = new Map(salary.map((s) => [s.operatorId, Number(s.remaining)]));
        return formatOperators(operators.map((o) => ({ name: o.name, machine: o.currentExcavator, remaining: due.get(o.id) ?? null })));
      }
      case "site.list": {
        const { sites } = await listSites(businessId, { pageSize: 100 });
        return formatSites(sites);
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
