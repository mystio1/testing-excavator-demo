"use client";

import useSWR, { useSWRConfig } from "swr";
import { ArrowRight, Trash2 } from "lucide-react";
import type { getOperatorPeriodsOverview } from "@/lib/services/workingPeriods";
import { apiFetch, swrFetcher } from "@/lib/api-client";
import type { Plain } from "@/lib/plain";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/dates";
import { StartSessionDialog } from "./start-session-dialog";
import { CloseSessionDialog } from "./close-session-dialog";
import { AddLeaveDialog } from "./add-leave-dialog";

type Overview = Plain<NonNullable<Awaited<ReturnType<typeof getOperatorPeriodsOverview>>>>;
type Period = Overview["periods"][number];

const day = (v: string | Date) => formatDate(new Date(v));

function Row({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold", tone, strong && "font-bold")}>{value}</span>
    </div>
  );
}

function SessionCard({ p, operatorId, isLast }: { p: Period; operatorId: string; isLast: boolean }) {
  const active = p.status === "ACTIVE";
  return (
    <Card className={cn(active && "border-primary/40")}>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold">Session #{p.sessionNumber}</span>
            <Badge variant={active ? "default" : "secondary"}>{active ? "Working" : "Closed"}</Badge>
          </div>
          <span className="text-muted-foreground">
            {day(p.startDate)} – {p.endDate ? day(p.endDate) : "ongoing"}
          </span>
        </div>

        {p.previousBalance !== 0 && (
          <div className="flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-amber-700 dark:text-amber-300">
            <ArrowRight className="size-3.5 shrink-0" />
            <span className="font-semibold">
              {formatCurrency(p.previousBalance)} carried forward from Session #{p.openingSourceSession}
            </span>
          </div>
        )}

        <Row label="Monthly Salary" value={formatCurrency(p.monthlySalary)} />
        {p.unpaidLeaveDeduction > 0 ? (
          <>
            {/* salaryEarned is already net of the leave, so show the gross it came from. */}
            <Row label="Salary Accrued" value={formatCurrency(p.salaryEarned + p.unpaidLeaveDeduction)} />
            <Row
              label="Less unpaid leave"
              value={`-${formatCurrency(p.unpaidLeaveDeduction)}`}
              tone="text-destructive"
            />
            {/* Which days were docked — the dates are clipped to this session,
                so a leave running past its end only shows the part that cost. */}
            <ul className="flex flex-col gap-1 pl-3 text-xs text-muted-foreground">
              {p.unpaidLeaveLines.map((l) => (
                <li key={l.leaveId} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    {day(l.from)} – {day(l.to)} · {l.days} day{l.days === 1 ? "" : "s"}
                    {l.reason ? ` · ${l.reason}` : ""}
                  </span>
                  <span className="shrink-0 tabular-nums">-{formatCurrency(l.amount)}</span>
                </li>
              ))}
            </ul>
            <Row label="Salary Earned" value={formatCurrency(p.salaryEarned)} strong />
          </>
        ) : (
          <Row label="Salary Earned" value={formatCurrency(p.salaryEarned)} />
        )}
        {p.bonus !== 0 && <Row label="Bonus" value={`+${formatCurrency(p.bonus)}`} tone="text-working" />}
        {p.salaryDeducted !== 0 && (
          <Row label="Deductions" value={`-${formatCurrency(p.salaryDeducted)}`} tone="text-destructive" />
        )}
        <Row label="Paid" value={`-${formatCurrency(p.salaryPaid)}`} />
        <div className="mt-1 flex justify-between border-t pt-2 text-base">
          <span className="font-semibold">{active ? "Pending" : "Closing Balance"}</span>
          <span className="font-bold">{formatCurrency(p.pending)}</span>
        </div>

        {p.balanceCarried && (
          <p className="text-xs text-muted-foreground">
            This balance was carried into Session #{p.carriedToSession}, so it is counted there.
          </p>
        )}

        {active && isLast && (
          <div className="pt-1">
            <CloseSessionDialog
              operatorId={operatorId}
              periodId={p.id}
              sessionNumber={p.sessionNumber}
              version={p.version}
              pending={p.pending}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SessionsPanel({ operatorId }: { operatorId: string }) {
  const { mutate } = useSWRConfig();
  const key = `/api/operators/${operatorId}/periods`;
  const { data, error } = useSWR<Overview>(key, swrFetcher);

  async function removeLeave(leaveId: string) {
    await apiFetch(`/api/operators/${operatorId}/leaves/${leaveId}`, { method: "DELETE" });
    await mutate((k) => typeof k === "string" && k.startsWith("/api/operators/"));
  }

  if (error) return <Card><CardContent className="py-8 text-center text-destructive">Could not load sessions.</CardContent></Card>;
  if (!data) return <Card><CardContent className="py-8 text-center text-muted-foreground">Loading sessions...</CardContent></Card>;

  const { summary, periods, leaves, timeline } = data;
  const activePeriod = periods.find((p) => p.status === "ACTIVE") ?? null;

  return (
    <div className="flex flex-col gap-4" data-agent-id="sessions-panel">
      <div className="flex flex-wrap gap-2">
        <StartSessionDialog
          operatorId={operatorId}
          activeVersion={activePeriod?.version}
          defaultMonthlySalary={activePeriod?.monthlySalary ?? periods[periods.length - 1]?.monthlySalary ?? 0}
        />
        <AddLeaveDialog operatorId={operatorId} />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="text-base font-bold">Salary Summary</p>
          <Row label="Sessions so far" value={String(summary.sessionCount)} />
          <Row label="Current session pending" value={formatCurrency(summary.currentSessionPending)} />
          {summary.previousSessionsPending !== 0 && (
            <Row
              label="Earlier sessions still owed"
              value={formatCurrency(summary.previousSessionsPending)}
              tone="text-working"
            />
          )}
          <div className="mt-1 flex justify-between border-t pt-2 text-base">
            <span className="font-semibold">Total Outstanding</span>
            <span className="font-bold">{formatCurrency(summary.totalOutstanding)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2">
          <p className="text-base font-bold">Timeline</p>
          <ol className="flex flex-col gap-2 text-sm">
            {timeline.map((e, i) => (
              <li key={i} className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    e.type === "WORKING" ? "bg-primary" : e.type === "LEAVE" ? "bg-amber-500" : "bg-muted-foreground",
                  )}
                />
                <span className="font-semibold">{e.label}</span>
                {e.type !== "PRESENT" && (
                  <span className="text-muted-foreground">
                    {day(e.startDate)}
                    {e.endDate ? ` – ${day(e.endDate)}` : " – ongoing"}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {[...periods].reverse().map((p) => (
        <SessionCard key={p.id} p={p} operatorId={operatorId} isLast={p.id === activePeriod?.id} />
      ))}

      {leaves.length > 0 && (
        <Card data-agent-id="leaves-list">
          <CardContent className="flex flex-col gap-2">
            <p className="text-base font-bold">Leaves</p>
            {leaves.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 border-b pb-2 text-sm last:border-0 last:pb-0">
                <div>
                  <p className="font-semibold">
                    {day(l.startDate)} – {day(l.endDate)}{" "}
                    <Badge variant="secondary">{l.type === "PAID" ? "Paid" : "Unpaid"}</Badge>
                  </p>
                  <p className="text-muted-foreground">
                    {l.days} days{l.reason ? ` · ${l.reason}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeLeave(l.id)}
                  aria-label="Delete leave"
                  className="rounded-lg p-2 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
