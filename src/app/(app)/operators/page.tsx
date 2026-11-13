"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { CheckCircle2, HardHat, Loader2, Plus, Trophy } from "lucide-react";
import type { getOperatorRankingLast45Days, listOperatorsPage, listPendingJoinRequests } from "@/lib/services/operators";
import { apiFetch, swrFetcher } from "@/lib/api-client";
import type { Plain } from "@/lib/plain";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SectionTitle } from "@/components/dashboard/section-title";
import { formatCurrency } from "@/lib/utils/currency";
import { formatHours } from "@/lib/utils/hours";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { DeleteOperatorButton } from "./delete-operator-button";
import { JoinRequestCard } from "./approvals/join-request-card";
import Loading from "../loading";

type OperatorRow = Plain<Awaited<ReturnType<typeof listOperatorsPage>>["operators"][number]> & { remainingSalary: number };

type OperatorsData = {
  operators: OperatorRow[];
  pendingLogCount: number;
  pendingWorkRequestCount: number;
  joinRequests: Plain<Awaited<ReturnType<typeof listPendingJoinRequests>>>;
  ranking: Plain<Awaited<ReturnType<typeof getOperatorRankingLast45Days>>>;
  nextCursor: string | null;
};

/** Extra pages fetched with "Load more", tied to the first-page response they
 * extend: when that response is refreshed (SWR mutate) they are discarded. */
type MorePages = { base: OperatorsData; rows: OperatorRow[]; cursor: string | null };

export default function OperatorsPage() {
  const { data } = useSWR<OperatorsData>("/api/operators", swrFetcher, { dedupingInterval: 15_000 });
  const [more, setMore] = useState<MorePages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  if (!data) return <Loading />;

  const { pendingLogCount, pendingWorkRequestCount, joinRequests, ranking } = data;
  const extra = more && more.base === data ? more : null;
  const operators = extra ? [...data.operators, ...extra.rows] : data.operators;
  const nextCursor = extra ? extra.cursor : (data.nextCursor ?? null);
  const pendingCount = pendingLogCount + pendingWorkRequestCount;

  async function loadMore(cursor: string) {
    if (!data) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await apiFetch<{ operators: OperatorRow[]; nextCursor: string | null }>(
        `/api/operators?limit=50&cursor=${encodeURIComponent(cursor)}`,
      );
      setMore((prev) => {
        const keep = prev && prev.base === data ? prev.rows : [];
        return { base: data, rows: [...keep, ...page.operators], cursor: page.nextCursor };
      });
    } catch (err) {
      setLoadMoreError(err instanceof Error ? err.message : "Could not load more operators");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Operators"
        action={
          <Button size="lg" className="h-11" nativeButton={false} render={<Link href="/operators/new" />}>
            <Plus className="size-5" />
            Add Operator
          </Button>
        }
      />

      <div data-agent-id="operator-list" className="flex flex-col gap-3 px-4 pb-6 md:px-8">
        {joinRequests.map((req) => (
          <JoinRequestCard key={req.id} request={req} />
        ))}
        {pendingCount > 0 && (
          <Link
            href="/operators/approvals"
            className="card-hover flex items-center justify-between gap-2 rounded-xl border border-idle/40 bg-idle/10 px-4 py-3 text-sm font-semibold text-idle-foreground"
          >
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-4" />
              {pendingCount} item{pendingCount === 1 ? "" : "s"} waiting for approval
            </span>
            <span>Review →</span>
          </Link>
        )}
        {operators.length === 0 ? (
          <EmptyState
            icon={HardHat}
            title="No Operators Yet"
            description="Add your first operator to assign them to machines and track salary."
            actionLabel="Add Operator"
            actionHref="/operators/new"
          />
        ) : (
          operators.map((op) => (
            <Card key={op.id} className="card-hover animate-fade-in-up">
              <CardContent className="flex items-center justify-between gap-2">
                <Link
                  href={`/operators/detail?id=${op.id}`}
                  // Assistant handle. Two operators sharing a surname is a
                  // question for the owner, which matchEntity enforces.
                  data-agent-id="operator-card"
                  data-agent-label={op.name}
                  className="min-w-0 flex-1"
                >
                  <p className="truncate text-lg font-bold">{op.name}</p>
                  <p className="text-sm text-muted-foreground">{op.mobile}</p>
                  <p className="text-sm text-muted-foreground">
                    {op.currentExcavator ? `On: ${op.currentExcavator}` : "Not assigned"}
                  </p>
                </Link>
                <div className="flex shrink-0 items-center gap-1">
                  <div className="text-right">
                    <p className="text-sm font-semibold">{formatCurrency(op.defaultMonthlySalary)}/mo</p>
                    {op.remainingSalary !== 0 && (
                      <p className={cn("text-xs font-semibold", op.remainingSalary > 0 ? "text-working" : "text-destructive")}>
                        {op.remainingSalary > 0 ? "Due: " : "Overpaid: "}
                        {formatCurrency(Math.abs(op.remainingSalary))}
                      </p>
                    )}
                  </div>
                  <DeleteOperatorButton operatorId={op.id} operatorName={op.name} />
                </div>
              </CardContent>
            </Card>
          ))
        )}

        {nextCursor && (
          <div className="flex flex-col items-center gap-2">
            <Button type="button" variant="outline" disabled={loadingMore} onClick={() => loadMore(nextCursor)}>
              {loadingMore ? <Loader2 className="size-4 animate-spin" /> : "Load more"}
            </Button>
            {loadMoreError && <p role="alert" className="text-sm font-medium text-destructive">{loadMoreError}</p>}
          </div>
        )}

        {ranking.length > 0 && (
          <Card className="animate-fade-in-up">
            <CardHeader>
              <SectionTitle icon={Trophy} tone="success">
                Ranking
              </SectionTitle>
              <p className="text-xs text-muted-foreground">
                Ranking is based on hours the operator has driven the excavator in the last 45 days.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {ranking.map((op, i) => (
                <div key={op.id} className="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                        i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="font-semibold">{op.name}</span>
                  </div>
                  <span className="text-sm font-bold">{formatHours(op.hours)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
