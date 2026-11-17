"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Banknote, CalendarDays, Clock, Droplets, Hammer, IndianRupee, Shovel, Truck, Wallet } from "lucide-react";
import type { getSiteAnalysis } from "@/lib/services/siteAnalysis";
import type { Plain } from "@/lib/plain";
import { swrFetcher } from "@/lib/api-client";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SummaryCard } from "@/components/dashboard/summary-card";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatCurrencyCompact } from "@/lib/utils/currency";
import { formatHours } from "@/lib/utils/hours";
import { Breadcrumbs, DateRangeFilter, KeyValue, SITE_TYPE_LABEL, SiteStatusBadge, fmtDay, qs } from "../shared";
import { DailyReadingsTable, DieselEntriesList } from "../readings-tables";
import { EditSiteDialog, RatesCard } from "../site-forms";
import { SiteReport } from "./site-report";
import { ShareSiteReportButton } from "./share-site-report-button";
import Loading from "../../loading";

type Analysis = Plain<NonNullable<Awaited<ReturnType<typeof getSiteAnalysis>>>>;

const money = (n: number) => ({ value: formatCurrencyCompact(n), exactValue: formatCurrency(n) });

/** Site Details: header, rates, performance cards, machines, work-type and diesel analysis, daily readings. */
export default function SiteDetailPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const excavatorId = params.get("excavatorId") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  const key = id ? `/api/sites/${id}/analysis${qs({ excavatorId, from, to })}` : null;
  const { data, error, mutate } = useSWR<Analysis>(key, swrFetcher, { keepPreviousData: true });
  // Same SWR key the app shell uses, so this costs no extra request.
  const { data: layout } = useSWR<{ businessName: string }>("/api/layout", swrFetcher);

  const setFilters = (patch: Partial<{ excavatorId: string; from: string; to: string }>) =>
    router.replace(`${pathname}${qs({ id, excavatorId, from, to, ...patch })}`, { scroll: false });

  if (!id || error) {
    return (
      <div>
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Site Analysis", href: "/site-analysis" }, { label: "Site" }]} />
        <EmptyState title="Site not found" description="This site does not exist or was removed." actionLabel="Back to Site Analysis" actionHref="/site-analysis" />
      </div>
    );
  }
  if (!data) return <Loading />;

  const { site, summary, machines, machineOptions, machinesWorking, workType, diesel, customerFinancials, rateHistory } = data;
  const machineLink = (excId: string) => `/site-analysis/machine${qs({ site: id, id: excId, from, to })}`;
  const reportPeriod = from || to ? `${from ? fmtDay(from) : "the start"} to ${to ? fmtDay(to) : "today"}` : "All time";

  return (
    <div>
      <Breadcrumbs
        items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Site Analysis", href: "/site-analysis" }, { label: site.name }]}
      />
      <PageHeader
        title={site.name}
        backHref="/site-analysis"
        action={<EditSiteDialog site={site} onReload={() => void mutate()} />}
      />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-8">
        <Card>
          <CardContent className="flex flex-wrap items-start justify-between gap-3 text-sm">
            <div className="flex flex-col gap-1">
              <p className="text-base font-semibold">
                {site.type === "SELF_SITE" || !site.customerId ? (
                  site.customerName
                ) : (
                  <Link href={`/customers/detail?id=${site.customerId}`} className="text-primary-text hover:underline">
                    {site.customerName}
                  </Link>
                )}
                {site.customerCompany ? ` — ${site.customerCompany}` : ""}
              </p>
              <p className="text-muted-foreground">{site.location ?? "No location"}</p>
              <p className="text-muted-foreground">{SITE_TYPE_LABEL[site.type] ?? site.type}</p>
            </div>
            <SiteStatusBadge status={site.status} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="text-base font-bold">Site Summary</p>
            <RatesCard
              key={`${site.version}`}
              siteId={site.id}
              version={site.version}
              bucketRate={site.bucketRate}
              breakerRate={site.breakerRate}
              onReload={() => void mutate()}
            />
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 border-t pt-3 text-sm sm:max-w-md">
              <KeyValue
                label="Machines Working Now"
                value={machinesWorking.length > 0 ? machinesWorking.map((m) => m.name).join(", ") : "None"}
              />
              {customerFinancials && (
                <>
                  <KeyValue label="Customer Total Revenue" value={formatCurrency(customerFinancials.billed)} />
                  <KeyValue label="Customer Payments" value={formatCurrency(customerFinancials.received)} />
                  <KeyValue label="Customer Pending" value={formatCurrency(customerFinancials.pending)} />
                </>
              )}
            </div>
            {customerFinancials && (
              <p className="text-xs text-muted-foreground">
                Customer figures cover all of this customer&rsquo;s bills across every site, so they are not the sum of the site figures below.
              </p>
            )}
            {rateHistory.length > 1 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold text-muted-foreground">Rate history</summary>
                <div className="mt-2 flex flex-col gap-1">
                  {rateHistory.map((h) => (
                    <p key={h.id} className="flex flex-wrap justify-between gap-2">
                      <span>{h.effectiveFrom === "1970-01-01" ? "From the start" : `From ${fmtDay(h.effectiveFrom)}`}</span>
                      <span className="tabular-nums">
                        Bucket {h.bucketRate != null ? formatCurrency(h.bucketRate) : "—"} · Brekar {h.breakerRate != null ? formatCurrency(h.breakerRate) : "—"}
                      </span>
                    </p>
                  ))}
                </div>
              </details>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="text-base font-bold">Filters</p>
            <NativeSelect
              aria-label="Machine"
              value={excavatorId}
              onChange={(e) => setFilters({ excavatorId: e.target.value })}
              className="h-11 sm:max-w-sm"
            >
              <option value="">All Machines</option>
              {machineOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.machineNumber ? ` (${m.machineNumber})` : ""}
                </option>
              ))}
            </NativeSelect>
            <DateRangeFilter from={from} to={to} onChange={(r) => setFilters(r)} />
          </CardContent>
        </Card>

        {/* The assistant reads its answer out of these figures, so the block
            that holds them is what it waits for and what it quotes. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-agent-id="site-summary">
          <SummaryCard icon={Truck} label="Machines" value={summary.machines} />
          <SummaryCard icon={Clock} label="Total Working Hours" value={formatHours(summary.hours)} accent="info" />
          <SummaryCard icon={Shovel} label="Bucket Hours" value={formatHours(summary.bucketHours)} accent="info" />
          <SummaryCard icon={Hammer} label="Brekar Hours" value={formatHours(summary.breakerHours)} accent="info" />
          <SummaryCard icon={Droplets} label="Diesel Used" value={`${summary.diesel} L`} accent="warning" />
          <SummaryCard icon={CalendarDays} label="Average Hours / Day" value={formatHours(summary.avgHoursPerDay)} accent="premium" />
          <SummaryCard icon={IndianRupee} label="Total Revenue" {...money(summary.revenue)} accent="success" />
          <SummaryCard icon={Banknote} label="Received" {...money(summary.received)} accent="info" />
          <SummaryCard icon={Wallet} label="Pending" {...money(summary.pending)} accent="danger" />
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-base font-bold">Share this analysis</p>
              <p className="text-sm text-muted-foreground">
                A PDF of everything on this page — site totals, work type, diesel and each machine&rsquo;s
                performance — for the current machine and date filters.
              </p>
            </div>
            <ShareSiteReportButton
              siteName={site.name}
              businessName={layout?.businessName ?? ""}
              customerMobile={site.customerMobile}
              period={reportPeriod}
              totals={{
                hours: summary.hours,
                revenue: summary.revenue,
                received: summary.received,
                pending: summary.pending,
                machines: summary.machines,
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="text-base font-bold">Work Type Analysis</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Work</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Bucket</TableCell>
                  <TableCell className="text-right tabular-nums">{formatHours(workType.bucket.hours)}</TableCell>
                  <TableCell className="text-right tabular-nums">{workType.bucket.rate != null ? `${formatCurrency(workType.bucket.rate)}/hr` : "—"}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(workType.bucket.revenue)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Brekar (Breaker)</TableCell>
                  <TableCell className="text-right tabular-nums">{formatHours(workType.breaker.hours)}</TableCell>
                  <TableCell className="text-right tabular-nums">{workType.breaker.rate != null ? `${formatCurrency(workType.breaker.rate)}/hr` : "—"}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(workType.breaker.revenue)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Other / not specified</TableCell>
                  <TableCell className="text-right tabular-nums">{formatHours(workType.other.hours)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">Unpriced</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(workType.other.revenue)}</TableCell>
                </TableRow>
                <TableRow className="font-bold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right tabular-nums">{formatHours(workType.totalHours)}</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums">{formatCurrency(workType.totalRevenue)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:max-w-sm">
              <KeyValue label="Billed (invoiced)" value={formatCurrency(workType.billedRevenue)} />
              <KeyValue label="Unbilled (at site rates)" value={formatCurrency(workType.unbilledRevenue)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Work is valued at the rate in force on its date; invoiced work always equals its bill.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="text-base font-bold">Diesel Analysis</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard icon={Droplets} label="Total Diesel" value={`${diesel.total} L`} accent="warning" />
              <SummaryCard icon={CalendarDays} label="Average Diesel / Day" value={`${diesel.avgPerDay} L`} accent="warning" />
              {/* The simple figure, always shown: diesel taken over hours
                  worked. It needs no tank readings, so the owner is never
                  left looking at "N/A" for an average they can work out in
                  their head. */}
              <SummaryCard
                icon={Droplets}
                label="Simple Average (Diesel ÷ Hours)"
                value={diesel.simple.litresPerHour === null ? "—" : `${diesel.simple.litresPerHour} L/hr`}
                exactValue={
                  diesel.simple.hoursPerLitre === null
                    ? undefined
                    : `${diesel.simple.hoursPerLitre} hrs per litre · ${formatHours(summary.hours)} ÷ ${summary.diesel} L`
                }
                accent="warning"
              />
              <SummaryCard
                icon={Clock}
                label="Exact Average (Diesel Burned)"
                value={diesel.avgPerHour === null ? "Not yet" : `${diesel.avgPerHour} L/hr`}
                accent="warning"
              />
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:max-w-md">
              <KeyValue
                label="Hours per litre (simple)"
                value={diesel.simple.hoursPerLitre === null ? "—" : `${diesel.simple.hoursPerLitre} hrs/L`}
              />
            </div>
            {/* The note the owner asked for: say plainly what the simple figure
                is and what to enter to get the exact one, instead of showing
                nothing and explaining nothing. */}
            <p className="text-xs text-muted-foreground">
              The <span className="font-semibold">simple average</span> is total diesel taken ÷ total hours worked
              ({summary.diesel} L ÷ {formatHours(summary.hours)}), shown whether or not the daily entries recorded
              the diesel left in the tank.{" "}
              {diesel.avgPerHour === null ? (
                <>
                  <span className="font-semibold">
                    Enter the diesel remaining in the tank now to get the exact reading.
                  </span>{" "}
                  The exact average measures diesel actually burned, so it is not affected by a large fill landing
                  on one day.
                </>
              ) : (
                <>
                  The <span className="font-semibold">exact average</span> measures diesel actually burned, from the
                  tank readings on the entries — use it in preference to the simple one.
                </>
              )}
            </p>
            <DieselEntriesList siteId={id} excavatorId={excavatorId || undefined} from={from || undefined} to={to || undefined} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-muted-foreground">Machines Working at this Site</p>
          {machines.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">No approved work for these filters.</CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {machines.map((m) => (
                <Card key={m.excavatorId}>
                  <CardContent className="flex flex-col gap-3">
                    <div>
                      <p className="text-lg font-bold">
                        {m.name}
                        {m.machineNumber ? ` (${m.machineNumber})` : ""}
                      </p>
                      <p className="text-sm text-muted-foreground">Operator: {m.operatorName ?? "—"}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <KeyValue label="Total Work" value={formatHours(m.hours)} />
                      <KeyValue label="Bucket Hours" value={formatHours(m.bucketHours)} />
                      <KeyValue label="Brekar Hours" value={formatHours(m.breakerHours)} />
                      <KeyValue label="Diesel" value={`${m.diesel} L`} />
                      <KeyValue label="Average Daily Work" value={formatHours(m.avgHoursPerDay)} />
                      <KeyValue label="Total Revenue" value={formatCurrency(m.revenue)} />
                    </div>
                    <Button size="lg" className="h-11" nativeButton={false} render={<Link href={machineLink(m.excavatorId)} />}>
                      View Machine Details
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {machines.length > 0 && (
          <Card>
            <CardContent className="flex flex-col gap-3">
              <p className="text-base font-bold">Machine-wise Summary</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Machine</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead className="text-right">Total Hours</TableHead>
                    <TableHead className="text-right">Bucket</TableHead>
                    <TableHead className="text-right">Brekar</TableHead>
                    <TableHead className="text-right">Diesel (L)</TableHead>
                    <TableHead className="text-right">Avg / Day</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {machines.map((m) => (
                    <TableRow key={m.excavatorId}>
                      <TableCell>
                        <Link href={machineLink(m.excavatorId)} className="font-semibold text-primary-text hover:underline">
                          {m.name}
                          {m.machineNumber ? ` (${m.machineNumber})` : ""}
                        </Link>
                      </TableCell>
                      <TableCell>{m.operatorName ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.hours}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.bucketHours}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.breakerHours}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.diesel}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.avgHoursPerDay}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(m.revenue)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold">
                    <TableCell>Site total</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums">{summary.hours}</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.bucketHours}</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.breakerHours}</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.diesel}</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.avgHoursPerDay}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(summary.revenue)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <DailyReadingsTable siteId={id} excavatorId={excavatorId || undefined} from={from || undefined} to={to || undefined} />
      </div>

      {/* The report the Share button photographs.
          Moved off-screen rather than hidden. html2canvas clones the node into
          its own iframe and copies the computed styles with it, so `display:
          none`, `visibility: hidden` or `opacity: 0` here would all produce a
          blank PDF — the node has to be genuinely laid out and genuinely
          painted, just nowhere the owner can see it. `aria-hidden` and
          `pointer-events: none` keep it out of the screen reader's way and out
          of the tab order. */}
      <div
        aria-hidden="true"
        className="pointer-events-none print-hidden"
        style={{ position: "fixed", top: 0, left: -20000, width: 820 }}
      >
        <SiteReport analysis={data} businessName={layout?.businessName ?? ""} from={from} to={to} />
      </div>
    </div>
  );
}
