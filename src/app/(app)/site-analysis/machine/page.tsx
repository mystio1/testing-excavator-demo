"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import type { getSiteAnalysis } from "@/lib/services/siteAnalysis";
import type { Plain } from "@/lib/plain";
import { swrFetcher } from "@/lib/api-client";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/currency";
import { formatHours } from "@/lib/utils/hours";
import { Breadcrumbs, DateRangeFilter, KeyValue, qs } from "../shared";
import { DailyReadingsTable, DieselEntriesList } from "../readings-tables";
import Loading from "../../loading";

type Analysis = Plain<NonNullable<Awaited<ReturnType<typeof getSiteAnalysis>>>>;

/** One machine within one site: work, diesel and revenue summaries plus the complete daily reading table. */
export default function SiteMachinePage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const siteId = params.get("site") ?? "";
  const excavatorId = params.get("id") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  const { data, error } = useSWR<Analysis>(
    siteId && excavatorId ? `/api/sites/${siteId}/analysis${qs({ excavatorId, from, to })}` : null,
    swrFetcher,
    { keepPreviousData: true },
  );

  const setRange = (r: { from: string; to: string }) =>
    router.replace(`${pathname}${qs({ site: siteId, id: excavatorId, ...r })}`, { scroll: false });

  if (!siteId || !excavatorId || error) {
    return (
      <div>
        <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Site Analysis", href: "/site-analysis" }, { label: "Machine" }]} />
        <EmptyState title="Machine not found" description="This machine or site does not exist." actionLabel="Back to Site Analysis" actionHref="/site-analysis" />
      </div>
    );
  }
  if (!data) return <Loading />;

  const { site, machine, summary, workType, diesel } = data;
  const siteHref = `/site-analysis/detail${qs({ id: siteId, from, to })}`;
  const title = machine ? `${machine.name}${machine.machineNumber ? ` (${machine.machineNumber})` : ""}` : "Machine";

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Site Analysis", href: "/site-analysis" },
          { label: site.name, href: siteHref },
          { label: "Machine Summary" },
        ]}
      />
      <PageHeader title={title} backHref={siteHref} />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-8">
        <Card>
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:max-w-lg">
            <KeyValue label="Machine" value={machine?.name ?? "—"} />
            <KeyValue label="Machine Number / ID" value={machine?.machineNumber ?? "—"} />
            <KeyValue label="Operator" value={machine?.operatorName ?? "—"} />
            <KeyValue label="Site" value={site.name} />
            <KeyValue label="Current Meter Reading" value={machine ? formatHours(machine.currentHourMeter) : "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="text-base font-bold">Date Range</p>
            <DateRangeFilter from={from} to={to} onChange={setRange} />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Card>
            <CardContent className="flex flex-col gap-2">
              <p className="text-base font-bold">Work Summary</p>
              <div className="grid grid-cols-2 gap-y-1 text-sm">
                <KeyValue label="Total Work" value={formatHours(summary.hours)} />
                <KeyValue label="Bucket Hours" value={formatHours(summary.bucketHours)} />
                <KeyValue label="Brekar Hours" value={formatHours(summary.breakerHours)} />
                <KeyValue label="Average Daily Work" value={formatHours(summary.avgHoursPerDay)} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-2">
              <p className="text-base font-bold">Diesel Summary</p>
              <div className="grid grid-cols-2 gap-y-1 text-sm">
                <KeyValue label="Total Diesel" value={`${diesel.total} L`} />
                <KeyValue label="Average / Day" value={`${diesel.avgPerDay} L`} />
                {/* Simple first, because it is always available: diesel taken
                    ÷ hours worked, and the same sum the other way up. */}
                <KeyValue
                  label="Simple Avg (Diesel ÷ Hrs)"
                  value={diesel.simple.litresPerHour === null ? "—" : `${diesel.simple.litresPerHour} L/hr`}
                  strong
                />
                <KeyValue
                  label="Hours per Litre"
                  value={diesel.simple.hoursPerLitre === null ? "—" : `${diesel.simple.hoursPerLitre} hrs/L`}
                />
                <KeyValue
                  label="Exact Avg (Burned)"
                  value={diesel.avgPerHour === null ? "Not yet" : `${diesel.avgPerHour} L/hr`}
                />
                {diesel.consumption?.avgLPerHour != null ? (
                  <>
                    <KeyValue label="Latest Rate" value={`${diesel.consumption.avgLPerHour} L/hr`} strong />
                    <KeyValue label="Diesel in Tank" value={`${diesel.consumption.currentTank} L`} />
                    {diesel.consumption.predictedHours != null && (
                      <KeyValue label="Can Run For" value={`${diesel.consumption.predictedHours} hrs`} strong />
                    )}
                  </>
                ) : (
                  <p className="col-span-2 pt-1 text-xs text-muted-foreground">
                    The simple average above is {summary.diesel} L ÷ {formatHours(summary.hours)} and needs nothing
                    further.{" "}
                    <span className="font-semibold">
                      Enter the diesel remaining in the tank now to get the exact reading
                    </span>{" "}
                    — that one measures diesel actually burned, and also predicts how long the tank will last.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-2">
              <p className="text-base font-bold">Revenue</p>
              <div className="grid grid-cols-2 gap-y-1 text-sm">
                <KeyValue label="Bucket Revenue" value={formatCurrency(workType.bucket.revenue)} />
                <KeyValue label="Brekar Revenue" value={formatCurrency(workType.breaker.revenue)} />
                <KeyValue label="Total Revenue" value={formatCurrency(workType.totalRevenue)} strong />
              </div>
            </CardContent>
          </Card>
        </div>

        <DailyReadingsTable siteId={siteId} excavatorId={excavatorId} from={from || undefined} to={to || undefined} showMachine={false} />

        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="text-base font-bold">Diesel Entries</p>
            <DieselEntriesList siteId={siteId} excavatorId={excavatorId} from={from || undefined} to={to || undefined} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
