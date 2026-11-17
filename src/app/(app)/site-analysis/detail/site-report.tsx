"use client";

import type { getSiteAnalysis } from "@/lib/services/siteAnalysis";
import type { Plain } from "@/lib/plain";
import { formatCurrency } from "@/lib/utils/currency";
import { formatHours } from "@/lib/utils/hours";
import { formatDate } from "@/lib/utils/dates";
import { SITE_TYPE_LABEL, fmtDay } from "../shared";

export type Analysis = Plain<NonNullable<Awaited<ReturnType<typeof getSiteAnalysis>>>>;

/** The id the detail page puts on the rendered report, for the PDF capture. */
export const SITE_REPORT_AREA_ID = "site-report-area";

/**
 * The shareable Site Analysis report: everything about the site overall, then
 * every machine's own performance.
 *
 * It is a plain light-background document rather than the app's cards, for two
 * reasons. It is photographed into a PDF (html2canvas-pro, see bill-pdf.ts) and
 * sent to a customer or a partner over WhatsApp, where the app's dark theme and
 * accent tiles read as a screenshot rather than a statement. And it is built
 * from THE SAME `analysis` object the page renders, so a figure in the PDF can
 * never disagree with the figure on screen — there is no second set of sums
 * here, only formatting.
 *
 * Kept mounted but off-screen (see the detail page) because html2canvas can
 * only photograph a node that is actually laid out.
 */
export function SiteReport({
  analysis,
  businessName,
  from,
  to,
}: {
  analysis: Analysis;
  businessName: string;
  from: string;
  to: string;
}) {
  const { site, summary, machines, workType, diesel, customerFinancials, machinesWorking } = analysis;
  const period = from || to ? `${from ? fmtDay(from) : "the start"} to ${to ? fmtDay(to) : "today"}` : "All time";

  return (
    <div
      id={SITE_REPORT_AREA_ID}
      // Fixed width: the capture is taken at 820 CSS px (CAPTURE_WIDTH), so a
      // phone-width screen still produces a full-width A4 page.
      style={{ width: 820, background: "#ffffff", color: "#111827" }}
      className="p-8 text-[13px]"
    >
      <header className="flex items-start justify-between gap-6 border-b-2 border-[#111827] pb-4">
        <div>
          <p className="text-xl font-bold">{businessName}</p>
          <p className="mt-0.5 text-[15px] font-semibold">Site Analysis Report</p>
        </div>
        <div className="text-right text-[12px] leading-5">
          <p>
            <span className="text-[#6b7280]">Period: </span>
            <span className="font-semibold">{period}</span>
          </p>
          <p>
            <span className="text-[#6b7280]">Generated: </span>
            {formatDate(new Date())}
          </p>
        </div>
      </header>

      <Section title="Site">
        <Grid
          rows={[
            ["Site", site.name],
            ["Type", SITE_TYPE_LABEL[site.type] ?? site.type],
            ["Customer", site.customerCompany ? `${site.customerName} — ${site.customerCompany}` : site.customerName],
            ["Location", site.location ?? "—"],
            ["Status", site.status],
            ["Bucket rate", site.bucketRate != null ? `${formatCurrency(site.bucketRate)}/hr` : "—"],
            ["Brekar rate", site.breakerRate != null ? `${formatCurrency(site.breakerRate)}/hr` : "—"],
            ["Machines working now", machinesWorking.length > 0 ? machinesWorking.map((m) => m.name).join(", ") : "None"],
          ]}
        />
      </Section>

      <Section title="Overall">
        <Grid
          rows={[
            ["Machines", String(summary.machines)],
            ["Total working hours", formatHours(summary.hours)],
            ["Bucket hours", formatHours(summary.bucketHours)],
            ["Brekar hours", formatHours(summary.breakerHours)],
            ["Other / unspecified hours", formatHours(summary.otherHours)],
            ["Days worked", String(summary.workDays)],
            ["Average hours per day", formatHours(summary.avgHoursPerDay)],
            ["Total diesel", `${summary.diesel} L`],
          ]}
        />
        <div className="mt-3 flex gap-3">
          <Money label="Total Revenue" value={summary.revenue} />
          <Money label="Received" value={summary.received} />
          <Money label="Pending" value={summary.pending} emphasis />
        </div>
      </Section>

      <Section title="Work Type">
        <Table
          head={["Work", "Hours", "Rate", "Revenue"]}
          align={["left", "right", "right", "right"]}
          rows={[
            [
              "Bucket",
              formatHours(workType.bucket.hours),
              workType.bucket.rate != null ? `${formatCurrency(workType.bucket.rate)}/hr` : "—",
              formatCurrency(workType.bucket.revenue),
            ],
            [
              "Brekar (Breaker)",
              formatHours(workType.breaker.hours),
              workType.breaker.rate != null ? `${formatCurrency(workType.breaker.rate)}/hr` : "—",
              formatCurrency(workType.breaker.revenue),
            ],
            ["Other / not specified", formatHours(workType.other.hours), "Unpriced", formatCurrency(workType.other.revenue)],
          ]}
          total={["Total", formatHours(workType.totalHours), "", formatCurrency(workType.totalRevenue)]}
        />
        <p className="mt-2 text-[11px] text-[#6b7280]">
          Billed (invoiced): {formatCurrency(workType.billedRevenue)} · Unbilled (at site rates):{" "}
          {formatCurrency(workType.unbilledRevenue)}. Work is valued at the rate in force on its date; invoiced work
          always equals its bill.
        </p>
      </Section>

      <Section title="Diesel">
        <Grid
          rows={[
            ["Total diesel taken", `${diesel.total} L`],
            ["Average per day", `${diesel.avgPerDay} L`],
            [
              "Simple average (diesel ÷ hours)",
              diesel.simple.litresPerHour === null ? "—" : `${diesel.simple.litresPerHour} L/hr`,
            ],
            ["Hours per litre", diesel.simple.hoursPerLitre === null ? "—" : `${diesel.simple.hoursPerLitre} hrs/L`],
            ["Exact average (diesel burned)", diesel.avgPerHour === null ? "Not yet recorded" : `${diesel.avgPerHour} L/hr`],
          ]}
        />
        {diesel.avgPerHour === null && (
          <p className="mt-2 text-[11px] text-[#6b7280]">
            The simple average is total diesel taken ÷ total hours worked. Enter the diesel remaining in the tank to
            get the exact reading, which measures diesel actually burned.
          </p>
        )}
      </Section>

      <Section title="Machine Performance">
        {machines.length === 0 ? (
          <p className="text-[#6b7280]">No approved work in this period.</p>
        ) : (
          <>
            <Table
              head={["Machine", "Operator", "Hours", "Bucket", "Brekar", "Diesel (L)", "Avg/Day", "L/hr", "Revenue"]}
              align={["left", "left", "right", "right", "right", "right", "right", "right", "right"]}
              rows={machines.map((m) => [
                m.machineNumber ? `${m.name} (${m.machineNumber})` : m.name,
                m.operatorName ?? "—",
                String(m.hours),
                String(m.bucketHours),
                String(m.breakerHours),
                String(m.diesel),
                String(m.avgHoursPerDay),
                m.hours > 0 && m.diesel > 0 ? String(Math.round((m.diesel / m.hours) * 100) / 100) : "—",
                formatCurrency(m.revenue),
              ])}
              total={[
                "Site total",
                "",
                String(summary.hours),
                String(summary.bucketHours),
                String(summary.breakerHours),
                String(summary.diesel),
                String(summary.avgHoursPerDay),
                summary.hours > 0 && summary.diesel > 0
                  ? String(Math.round((summary.diesel / summary.hours) * 100) / 100)
                  : "—",
                formatCurrency(summary.revenue),
              ]}
            />
            {/* Each machine again, in full — the table above is the comparison,
                this is the per-machine detail the owner asked to be included. */}
            <div className="mt-4 flex flex-col gap-3">
              {machines.map((m) => (
                <div key={m.excavatorId} className="break-inside-avoid rounded border border-[#e5e7eb] p-3">
                  <p className="font-bold">
                    {m.name}
                    {m.machineNumber ? ` (${m.machineNumber})` : ""}
                    <span className="ml-2 font-normal text-[#6b7280]">Operator: {m.operatorName ?? "—"}</span>
                  </p>
                  <div className="mt-2">
                    <Grid
                      compact
                      rows={[
                        ["Total hours", formatHours(m.hours)],
                        ["Bucket hours", formatHours(m.bucketHours)],
                        ["Brekar hours", formatHours(m.breakerHours)],
                        ["Other hours", formatHours(m.otherHours)],
                        ["Days worked", String(m.workDays)],
                        ["Average hours per day", formatHours(m.avgHoursPerDay)],
                        ["Diesel taken", `${m.diesel} L`],
                        ["Average diesel per day", `${m.avgDieselPerDay} L`],
                        [
                          "Simple average",
                          m.hours > 0 && m.diesel > 0
                            ? `${Math.round((m.diesel / m.hours) * 100) / 100} L/hr`
                            : "—",
                        ],
                        ["Revenue", formatCurrency(m.revenue)],
                        ["Received", formatCurrency(m.received)],
                        ["Pending", formatCurrency(m.pending)],
                      ]}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      {customerFinancials && (
        <Section title="Customer Account">
          <Grid
            rows={[
              ["Customer total revenue", formatCurrency(customerFinancials.billed)],
              ["Customer payments", formatCurrency(customerFinancials.received)],
              ["Customer pending", formatCurrency(customerFinancials.pending)],
            ]}
          />
          <p className="mt-2 text-[11px] text-[#6b7280]">
            Customer figures cover all of this customer&rsquo;s bills across every site, so they are not the sum of
            the site figures above.
          </p>
        </Section>
      )}

      <footer className="mt-6 border-t border-[#e5e7eb] pt-3 text-[11px] text-[#6b7280]">
        {businessName} · Site Analysis for {site.name} · {period}
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 break-inside-avoid">
      <h2 className="mb-2 border-b border-[#e5e7eb] pb-1 text-[14px] font-bold uppercase tracking-wide">{title}</h2>
      {children}
    </section>
  );
}

function Grid({ rows, compact }: { rows: [string, string][]; compact?: boolean }) {
  return (
    <div className={compact ? "grid grid-cols-3 gap-x-5" : "grid grid-cols-2 gap-x-8"}>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 border-b border-[#f3f4f6] py-1">
          <span className="text-[#6b7280]">{label}</span>
          <span className="text-right font-semibold tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  );
}

function Money({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div
      className="flex-1 rounded border p-2.5"
      style={emphasis ? { borderColor: "#111827", background: "#f9fafb" } : { borderColor: "#e5e7eb" }}
    >
      <p className="text-[11px] uppercase tracking-wide text-[#6b7280]">{label}</p>
      <p className="mt-0.5 text-[16px] font-bold tabular-nums">{formatCurrency(value)}</p>
    </div>
  );
}

function Table({
  head,
  rows,
  total,
  align,
}: {
  head: string[];
  rows: string[][];
  total?: string[];
  align: ("left" | "right")[];
}) {
  const cell = (i: number) => (align[i] === "right" ? "text-right tabular-nums" : "text-left");
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th
              key={h}
              className={`border-b border-[#d1d5db] px-1.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#6b7280] ${cell(i)}`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((c, i) => (
              <td key={i} className={`border-b border-[#f3f4f6] px-1.5 py-1 ${cell(i)}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
        {total && (
          <tr>
            {total.map((c, i) => (
              <td key={i} className={`border-t-2 border-[#111827] px-1.5 py-1 font-bold ${cell(i)}`}>
                {c}
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  );
}
