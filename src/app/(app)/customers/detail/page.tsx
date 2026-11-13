"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { useState } from "react";
import { CalendarDays, ChevronDown, ChevronUp, Clock, FileText, Pencil, Truck } from "lucide-react";
import type { getCustomerDetail } from "@/lib/services/customers";
import type { Plain } from "@/lib/plain";
import { swrFetcher } from "@/lib/api-client";
import { PageHeader } from "@/components/page-header";
import { SummaryCard } from "@/components/dashboard/summary-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/native-select";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrencyCompact } from "@/lib/utils/currency";
import { formatDate, formatDateRange } from "@/lib/utils/dates";
import { formatHours } from "@/lib/utils/hours";
import { StatusBadge } from "@/components/status-badge";
import Loading from "../../loading";
import { EditSessionButton } from "../../excavators/detail/edit-session-button";
import { EditReadingButton } from "../../excavators/detail/edit-reading-button";
import { DeleteReadingButton } from "../../excavators/detail/delete-reading-button";

type CustomerDetail = Plain<NonNullable<Awaited<ReturnType<typeof getCustomerDetail>>>>;
type Work = CustomerDetail["machineHistory"][number];

/** One job for this customer: the summary, a "Details" view with every recorded value, and admin edit. */
function WorkCard({ work: h, invalidateKey }: { work: Work; invalidateKey: string }) {
  const [open, setOpen] = useState(false);
  const row = (label: string, value: string | number | null | undefined) => (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-semibold">{value === null || value === undefined || value === "" ? "—" : value}</span>
    </>
  );
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-bold">{h.excavatorName}</p>
            {h.machineNumber && <p className="text-sm text-muted-foreground">{h.machineNumber}</p>}
          </div>
          <div className="flex items-center gap-1">
            {h.status === "ACTIVE" && <StatusBadge status="WORKING" />}
            <EditSessionButton session={h} invalidateKey={invalidateKey} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{h.siteName}</p>
        <p className="text-sm">{formatDateRange(h.startDate, h.endDate)}</p>
        <div className="mt-1 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Operator: {h.operatorName}</span>
          <span className="font-semibold">{formatHours(h.totalHours)}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 self-start"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          {open ? "Hide details" : "View details"}
        </Button>
        {open && (
          <div className="mt-1 flex flex-col gap-2 border-t pt-2">
            <div className="grid grid-cols-2 gap-y-1 text-sm">
              {row("Tool / attachment", h.attachment)}
              {row("Start reading", formatHours(h.startHourMeter))}
              {row("End reading", h.endHourMeter != null ? formatHours(h.endHourMeter) : null)}
              {row("Total hours", formatHours(h.totalHours))}
              {row(
                "Diesel taken",
                h.dieselLiters != null ? `${h.dieselLiters} L${h.dieselDate ? ` (${formatDate(new Date(h.dieselDate))})` : ""}` : null,
              )}
              {row("Status", h.status === "ACTIVE" ? "Working" : "Completed")}
              {row("Billed", h.billed ? "Yes" : "No")}
              {row("Notes", h.notes)}
            </div>
            {h.dailyLogs.length > 0 && (
              <div className="flex flex-col border-t pt-2">
                <p className="pb-1 text-xs font-semibold text-muted-foreground">Daily readings</p>
                {h.dailyLogs.map((log) => (
                  <div key={log.id} className="flex flex-col gap-0.5 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {formatDate(new Date(log.date))}
                        {log.status !== "APPROVED" && <span className="ml-2 text-xs text-muted-foreground">({log.status.toLowerCase()})</span>}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold">{formatHours(log.hoursWorked)}</span>
                        <EditReadingButton log={log} invalidateKey={invalidateKey} />
                        <DeleteReadingButton logId={log.id} version={log.version} invalidateKey={invalidateKey} />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {log.startHourMeter != null && log.endHourMeter != null
                        ? `Meter ${formatHours(log.startHourMeter)} → ${formatHours(log.endHourMeter)}`
                        : log.startTime && log.stopTime
                          ? `${log.startTime} – ${log.stopTime}${log.breakMinutes ? ` (break ${log.breakMinutes} min)` : ""}`
                          : null}
                      {log.attachment ? ` · Tool: ${log.attachment}` : ""}
                      {log.dieselLiters != null ? ` · Diesel: ${log.dieselLiters} L` : ""}
                      {log.operatorName ? ` · ${log.operatorName}` : ""}
                    </p>
                    {log.notes && <p className="text-xs text-muted-foreground">{log.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CustomerDetailPage() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const excavatorId = searchParams.get("excavatorId") ?? "";
  const site = searchParams.get("site") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  const query = new URLSearchParams({ id });
  if (excavatorId) query.set("excavatorId", excavatorId);
  if (site) query.set("site", site);
  if (from) query.set("from", from);
  if (to) query.set("to", to);

  const { data } = useSWR<{ detail: CustomerDetail }>(id ? `/api/customers/detail?${query.toString()}` : null, swrFetcher);

  const invalidateKey = `/api/customers/detail?${query.toString()}`;
  if (!data) return <Loading />;
  const {
    customer,
    totalMachinesUsed,
    totalWorkingDays,
    totalHours,
    totalRevenue,
    pending,
    machineOptions,
    siteOptions,
    machineHistory,
  } = data.detail;

  const hasFilters = !!(excavatorId || site || from || to);

  return (
    <div>
      <PageHeader
        title={customer.name}
        backHref="/customers"
        action={
          <div className="flex gap-2">
            <Button size="lg" className="h-11" nativeButton={false} render={<Link href={`/bills?customerId=${customer.id}`} />}>
              <FileText className="size-4" />
              View &amp; Print Bill
            </Button>
            <Button
              size="lg"
              className="h-11"
              variant="secondary"
              nativeButton={false}
              render={<Link href={`/customers/detail/edit?id=${customer.id}`} />}
            >
              <Pencil className="size-4" />
              Edit
            </Button>
          </div>
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-8" data-agent-id="customer-detail">
        <Card>
          <CardContent className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1 text-sm">
              {customer.companyName && <p className="font-semibold">{customer.companyName}</p>}
              <p className="text-muted-foreground">{customer.mobile}</p>
              {customer.address && <p className="text-muted-foreground">{customer.address}</p>}
              {customer.gstNumber && <p className="text-muted-foreground">GST: {customer.gstNumber}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-working/15 px-3 py-1 text-sm font-semibold text-working">
                {formatCurrencyCompact(totalRevenue)} Total
              </span>
              {pending > 0.01 && (
                <span className="rounded-full bg-destructive/15 px-3 py-1 text-sm font-semibold text-destructive">
                  {formatCurrencyCompact(pending)} Pending
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard icon={Truck} label="Machines Used" value={totalMachinesUsed} />
          <SummaryCard icon={CalendarDays} label="Working Days" value={totalWorkingDays} />
          <SummaryCard icon={Clock} label="Total Hours" value={formatHours(totalHours)} />
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-muted-foreground">Machine History</p>

          <form method="get" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input type="hidden" name="id" value={id} />
            <NativeSelect name="excavatorId" aria-label="Machine" defaultValue={excavatorId} className="h-11">
              <option value="">All Machines</option>
              {machineOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.machineNumber ? ` (${m.machineNumber})` : ""}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect name="site" aria-label="Site" defaultValue={site} className="h-11">
              <option value="">All Sites</option>
              {siteOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </NativeSelect>
            {/* Stacked below sm: — a native date input squeezed to half a
                phone-width row clips its own "dd-mm-yyyy" text, leaving only
                the calendar icon visible. Visible labels too — an empty
                date input shows no placeholder text at all on some mobile
                browsers, so an aria-label alone left the field looking like
                a plain blank box with no hint of what it's for. */}
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="from-date" className="text-xs text-muted-foreground">
                  From Date
                </Label>
                <Input id="from-date" type="date" name="from" defaultValue={from} className="h-11" />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="to-date" className="text-xs text-muted-foreground">
                  To Date
                </Label>
                <Input id="to-date" type="date" name="to" defaultValue={to} className="h-11" />
              </div>
            </div>
            <div className="sm:col-span-3">
              <Button type="submit" size="sm" variant="secondary">
                Apply Filters
              </Button>
              {hasFilters && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="ml-2"
                  nativeButton={false}
                  render={<Link href={`/customers/detail?id=${customer.id}`} />}
                >
                  Clear
                </Button>
              )}
            </div>
          </form>

          {machineHistory.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No work recorded for this customer{hasFilters ? " matching these filters" : " yet"}.
              </CardContent>
            </Card>
          )}
          {machineHistory.map((h) => (
            <WorkCard key={h.id} work={h} invalidateKey={invalidateKey} />
          ))}
        </div>
      </div>
    </div>
  );
}
