"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { AlertTriangle, ChevronDown, ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { swrFetcher } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/currency";
import { formatHours } from "@/lib/utils/hours";
import { todayLocal } from "@/lib/utils/dates";
import type { Plain } from "@/lib/plain";
import type { EarningsBucket, EarningsPeriod, getMachineEarnings } from "@/lib/services/siteAnalysis";

type EarningsData = Plain<Awaited<ReturnType<typeof getMachineEarnings>>>;

const PERIODS: { value: EarningsPeriod; label: string }[] = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
];

/** One size for every amount on the card, so the figures line up and compare at a glance. */
const AMOUNT = "text-base font-bold tabular-nums whitespace-nowrap sm:text-lg";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Bucket dates are yyyy-MM-dd (UTC midnight days), so they are labelled from the string. */
function bucketLabel(b: EarningsBucket, period: EarningsPeriod) {
  const [y, m, d] = b.start.split("-").map(Number);
  if (period === "year") return String(y);
  if (period === "month") return `${MONTHS[m - 1]} ${y}`;
  if (period === "day") return `${d} ${MONTHS[m - 1]}`;
  const [, em, ed] = b.end.split("-").map(Number);
  return em === m ? `${d}–${ed} ${MONTHS[m - 1]}` : `${d} ${MONTHS[m - 1]} – ${ed} ${MONTHS[em - 1]}`;
}

export function MachinePerformanceList() {
  const [period, setPeriod] = useState<EarningsPeriod>("month");
  // null = the newest (current) period of whichever view is selected
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const today = todayLocal();
  const { data, error } = useSWR<EarningsData>(
    `/api/excavators/performance?period=${period}&today=${today}`,
    swrFetcher,
    { keepPreviousData: true },
  );

  const buckets = data?.period === period ? data.buckets : [];
  const selectedIndex = (() => {
    const i = buckets.findIndex((b) => b.key === selectedKey);
    return i >= 0 ? i : buckets.length - 1;
  })();
  const selected = buckets[selectedIndex];
  const machines = data?.machines ?? [];
  const fleetRevenue = machines.reduce((t, m) => t + (m.series[selectedIndex]?.revenue ?? 0), 0);
  const fleetHours = machines.reduce((t, m) => t + (m.series[selectedIndex]?.hours ?? 0), 0);
  const missing = data?.missingRateSites ?? [];

  return (
    <Card className="animate-fade-in-up" data-agent-id="machine-performance">
      <CardHeader className="flex flex-col gap-3">
        <CardTitle className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary-text">
            <ClipboardList className="size-4" />
          </span>
          Machine Performance
        </CardTitle>

        <div role="tablist" aria-label="Timeline" className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              role="tab"
              aria-selected={period === p.value}
              onClick={() => {
                setPeriod(p.value);
                setSelectedKey(null);
                setExpanded(null);
              }}
              className={cn(
                "rounded-md px-2 py-1.5 text-sm font-semibold transition-colors",
                period === p.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {buckets.length > 0 && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Period">
            {[...buckets].reverse().map((b) => {
              const active = b.key === selected?.key;
              return (
                <button
                  key={b.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedKey(b.key)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors",
                    active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
                  )}
                >
                  {bucketLabel(b, period)}
                </button>
              );
            })}
          </div>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-1">
        {error && !data && <p className="text-sm text-destructive">Could not load machine performance.</p>}
        {!data && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

        {missing.length > 0 && (
          <div role="alert" className="mb-2 flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="flex flex-col gap-1">
              <p className="font-semibold">Site rate not set — this work is counted as ₹0</p>
              <p>Update the rate for these sites so machine revenue is shown correctly:</p>
              <ul className="flex flex-col gap-0.5">
                {missing.map((s) => (
                  <li key={s.id}>
                    <Link href={`/site-analysis/detail?id=${encodeURIComponent(s.id)}`} className="font-semibold underline">
                      {s.name}
                    </Link>{" "}
                    — {s.missing.join(" & ")} rate missing ({formatHours(s.hours)})
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {selected && (
          <div className="flex items-end justify-between gap-3 border-b pb-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">All machines</p>
              <p className="text-sm text-muted-foreground">
                {bucketLabel(selected, period)} · {formatHours(fleetHours)}
              </p>
            </div>
            <p className={AMOUNT}>{formatCurrency(fleetRevenue)}</p>
          </div>
        )}

        {selected &&
          machines.map((m) => {
            const point = m.series[selectedIndex];
            const isOpen = expanded === m.id;
            const max = Math.max(1, ...m.series.map((p) => p.revenue));
            return (
              <div key={m.id} className="border-b last:border-b-0">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : m.id)}
                  className="flex w-full flex-col gap-1 py-3 text-left"
                >
                  {/* Top line: name, with the status as a small tag in the top-right corner */}
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate font-bold">{m.name}</p>
                    <StatusBadge status={m.status} className="h-5 shrink-0 gap-1 px-1.5 text-[11px]" />
                  </div>
                  {/* Second line: number · hours on the left, amount on the right */}
                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-muted-foreground">
                        {m.machineNumber ? `${m.machineNumber} · ` : ""}
                        {formatHours(point?.hours ?? 0)}
                      </p>
                      {point && point.unpricedHours > 0 && (
                        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                          {formatHours(point.unpricedHours)} not priced — site rate missing
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <p className={AMOUNT}>{formatCurrency(point?.revenue ?? 0)}</p>
                      <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <ul className="mb-3 flex flex-col gap-1.5 rounded-lg bg-muted/50 p-3">
                    {[...m.series].reverse().map((p) => {
                      const b = buckets.find((x) => x.key === p.key)!;
                      return (
                        <li key={p.key} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-sm">
                          <span className="truncate text-muted-foreground">{bucketLabel(b, period)}</span>
                          <span className="h-2 overflow-hidden rounded-full bg-muted">
                            <span
                              className="block h-full rounded-full bg-primary"
                              style={{ width: `${(p.revenue / max) * 100}%` }}
                            />
                          </span>
                          <span className="text-right font-semibold tabular-nums">
                            {formatCurrency(p.revenue)}
                            <span className="ml-1 font-normal text-muted-foreground">· {formatHours(p.hours)}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
      </CardContent>
    </Card>
  );
}
