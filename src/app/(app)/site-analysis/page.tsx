"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Banknote, Clock, IndianRupee, MapPin, Search, Wallet } from "lucide-react";
import type { listSites } from "@/lib/services/siteAnalysis";
import type { Plain } from "@/lib/plain";
import { swrFetcher } from "@/lib/api-client";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SummaryCard } from "@/components/dashboard/summary-card";
import { NativeSelect } from "@/components/native-select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatCurrencyCompact } from "@/lib/utils/currency";
import { formatHours } from "@/lib/utils/hours";
import { Breadcrumbs, DateRangeFilter, KeyValue, Pager, SITE_TYPE_LABEL, SiteStatusBadge, fmtDay, qs } from "./shared";
import { CreateSiteDialog } from "./create-site-dialog";
import Loading from "../loading";

type SiteList = Plain<Awaited<ReturnType<typeof listSites>>>;

const PAGE_SIZE = 12;

/** Site Analysis home: every site with its totals. Filtering, aggregation and paging happen on the server. */
export default function SiteAnalysisPage() {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [excavatorId, setExcavatorId] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = qs({ q, type, status, excavatorId, from: range.from, to: range.to, page, pageSize: PAGE_SIZE });
  const { data, isLoading } = useSWR<SiteList>(`/api/sites${query}`, swrFetcher, { keepPreviousData: true });

  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };
  const hasFilters = !!(q || type || status || excavatorId || range.from || range.to);
  const detailQuery = qs({ from: range.from, to: range.to, excavatorId });

  if (!data) return isLoading ? <Loading /> : null;
  const { sites, summary, machineOptions } = data;

  return (
    <div>
      <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Site Analysis" }]} />
      <PageHeader title="Site Analysis" action={<CreateSiteDialog />} />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-8">
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search site, customer or location..."
                aria-label="Search sites"
                className="h-11 pl-9"
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <NativeSelect aria-label="Site type" value={type} onChange={(e) => reset(() => setType(e.target.value))} className="h-11">
                <option value="">All Types</option>
                <option value="CUSTOMER_SITE">Customer Site</option>
                <option value="SELF_SITE">Self Site</option>
              </NativeSelect>
              <NativeSelect aria-label="Site status" value={status} onChange={(e) => reset(() => setStatus(e.target.value))} className="h-11">
                <option value="">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="COMPLETED">Completed</option>
                <option value="ON_HOLD">On Hold</option>
              </NativeSelect>
              <NativeSelect aria-label="Machine" value={excavatorId} onChange={(e) => reset(() => setExcavatorId(e.target.value))} className="h-11">
                <option value="">All Machines</option>
                {machineOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.machineNumber ? ` (${m.machineNumber})` : ""}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <DateRangeFilter from={range.from} to={range.to} onChange={(r) => reset(() => setRange(r))} />
            {hasFilters && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="self-start"
                onClick={() => {
                  setSearch("");
                  setQ("");
                  setType("");
                  setStatus("");
                  setExcavatorId("");
                  setRange({ from: "", to: "" });
                  setPage(1);
                }}
              >
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard icon={MapPin} label="Sites" value={summary.sites} />
          <SummaryCard icon={Clock} label="Total Work" value={formatHours(summary.totalHours)} accent="info" />
          <SummaryCard
            icon={IndianRupee}
            label="Revenue"
            value={formatCurrencyCompact(summary.revenue)}
            exactValue={formatCurrency(summary.revenue)}
            accent="success"
          />
          <SummaryCard
            icon={Wallet}
            label="Pending"
            value={formatCurrencyCompact(summary.pending)}
            exactValue={formatCurrency(summary.pending)}
            accent="danger"
          />
        </div>

        {/* The annotation wraps BOTH the list and the empty state. Inside the
            list alone it vanished whenever there were no sites, so the
            assistant answered "I couldn't confirm" for a page that was
            perfectly correct and simply empty — "you have no sites yet" is a
            real answer to "show me my sites". Caught by the browser coverage
            pass; approvals.view had the same shape and was already fixed. */}
        <div data-agent-id="site-list" className="flex flex-col gap-3">
        {sites.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title={hasFilters ? "No sites match these filters" : "No sites yet"}
            description={hasFilters ? "Try a different search, status or date range." : "Create a site, or start work on a machine, to see site analysis here."}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {sites.map((s) => (
              // The label is what the assistant matches a spoken site name
              // against, so it carries the customer too: "Wakad" and "Shree ka
              // site" are both things an owner says for the same place.
              <Card
                key={s.id}
              >
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-bold">{s.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {SITE_TYPE_LABEL[s.type] ?? s.type} · {s.customerName}
                      </p>
                      {s.location && <p className="text-sm text-muted-foreground">{s.location}</p>}
                    </div>
                    <SiteStatusBadge status={s.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <KeyValue label="Machines Working" value={s.machinesWorking} />
                    <KeyValue label="Bucket Rate" value={s.bucketRate != null ? `${formatCurrency(s.bucketRate)}/hr` : "—"} />
                    <KeyValue label="Brekar Rate" value={s.breakerRate != null ? `${formatCurrency(s.breakerRate)}/hr` : "—"} />
                    <KeyValue label="Total Work" value={formatHours(s.totalHours)} />
                    <KeyValue label="Total Revenue" value={formatCurrency(s.revenue)} />
                    <KeyValue label="Pending" value={formatCurrency(s.pending)} />
                    <KeyValue label="Last Work" value={s.lastWorkDate ? fmtDay(s.lastWorkDate) : "—"} />
                  </div>
                  {/* Annotated on the control that NAVIGATES, not on the card
                      around it — machine-card does the same. The assistant
                      clicks the element it was given, and a <Card> has no
                      handler, so annotating the wrapper meant every click did
                      nothing and the run reported "I couldn't confirm". The
                      label carries the site and its customer, because the
                      link's own text is just "View Site". */}
                  <Button
                    size="lg"
                    className="h-11"
                    nativeButton={false}
                    data-agent-id="site-card"
                    data-agent-label={[s.name, s.customerName].filter(Boolean).join(" ")}
                    render={<Link href={`/site-analysis/detail${qs({ id: s.id })}${detailQuery.replace("?", "&")}`} />}
                  >
                    <Banknote className="size-4" />
                    View Site
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        </div>
        <Pager page={data.page} totalPages={data.totalPages} total={data.total} noun="site" onPage={setPage} />
      </div>
    </div>
  );
}
