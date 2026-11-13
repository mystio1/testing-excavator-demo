"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ChevronLeft, ChevronRight, Pencil, Truck } from "lucide-react";
import type { getOperatorDetail } from "@/lib/services/operators";
import type { listCategories, listTransactions } from "@/lib/services/operatorTransactions";
import type { computeSalaryForMonth, getLifetimeSalarySummary } from "@/lib/services/salary";
import { apiFetch, swrFetcher } from "@/lib/api-client";
import type { Plain } from "@/lib/plain";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, formatDateRange } from "@/lib/utils/dates";
import { formatHours } from "@/lib/utils/hours";
import { cn } from "@/lib/utils";
import { AddTransactionDialog } from "./add-transaction-dialog";
import { EditTransactionDialog } from "./edit-transaction-dialog";
import { DeleteTransactionButton } from "./delete-transaction-button";
import { OperatorPinCard } from "./operator-pin-card";
import { SalaryBreakdownDialog } from "./salary-breakdown-dialog";
import { SessionsPanel } from "./sessions-panel";
import { SessionSummaryCard } from "./session-summary-card";
import Loading from "../../loading";

const MONTH_LABEL = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });

// Money arrives as plain numbers once serialized (see Plain / money.ts).
type OperatorDetail = Plain<NonNullable<Awaited<ReturnType<typeof getOperatorDetail>>>>;
type DetailData = {
  detail: OperatorDetail;
  categories: Plain<Awaited<ReturnType<typeof listCategories>>>;
  transactions: Plain<Awaited<ReturnType<typeof listTransactions>>>;
  /** Set when more transactions exist beyond the requested `limit`. */
  nextCursor?: string | null;
  salary: Plain<Awaited<ReturnType<typeof computeSalaryForMonth>>>;
  lifetimeSalary: Plain<Awaited<ReturnType<typeof getLifetimeSalarySummary>>>;
  suggestedAmount?: number | null;
};

type Transaction = Plain<Awaited<ReturnType<typeof listTransactions>>[number]>;

const PAGE_SIZE = 50;

export default function OperatorDetailPage() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const tab = searchParams.get("tab") ?? "transactions";
  const monthParam = searchParams.get("month");

  const now = new Date();
  const [monthYear, monthIndex] = monthParam ? monthParam.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
  const salaryDate = new Date(monthYear!, monthIndex! - 1, 1);
  const prevMonth = new Date(monthYear!, monthIndex! - 2, 1);
  const nextMonth = new Date(monthYear!, monthIndex!, 1);

  // The detail endpoint returns the first page of transactions (+ nextCursor);
  // "Load more" appends the following pages from the transactions endpoint.
  // Extra pages are tied to the SWR data they were loaded against, so any
  // revalidation that changes the data (add / edit / delete) starts over from
  // the fresh first page instead of showing stale rows.
  const [more, setMore] = useState<{ base: unknown; items: Transaction[]; nextCursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const query = new URLSearchParams({ id, limit: String(PAGE_SIZE) });
  if (monthParam) query.set("month", monthParam);

  const { data } = useSWR<DetailData>(id ? `/api/operators/detail?${query.toString()}` : null, swrFetcher, {
    dedupingInterval: 15_000,
  });

  if (!data) return <Loading />;
  const { operator, assignedExcavator, pastWork } = data.detail;
  const { categories, salary, lifetimeSalary, suggestedAmount } = data;
  const extra = more && more.base === data ? more : null;
  const transactions = extra ? [...data.transactions, ...extra.items] : data.transactions;
  const nextCursor = extra ? extra.nextCursor : (data.nextCursor ?? null);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await apiFetch<{ transactions: Transaction[]; nextCursor: string | null }>(
        `/api/operators/${operator.id}/transactions?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(nextCursor)}`,
      );
      setMore({ base: data, items: [...(extra?.items ?? []), ...page.transactions], nextCursor: page.nextCursor });
    } catch (err) {
      setLoadMoreError(err instanceof Error ? err.message : "Could not load more transactions");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={operator.name}
        backHref="/operators"
        action={
          <Button
            size="lg"
            className="h-11"
            variant="secondary"
            nativeButton={false}
            render={<Link href={`/operators/detail/edit?id=${operator.id}`} />}
          >
            <Pencil className="size-4" />
            Edit
          </Button>
        }
      />
      <div className="-mt-3 px-4 pb-2 md:px-8">
        {assignedExcavator ? (
          <Link
            href={`/excavators/detail?id=${assignedExcavator.id}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary-text"
          >
            <Truck className="size-3.5" />
            On {assignedExcavator.name}
            {assignedExcavator.machineNumber ? ` (${assignedExcavator.machineNumber})` : ""}
          </Link>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Truck className="size-3.5" />
            Not currently assigned to a machine — assign from the Machine page
          </p>
        )}
      </div>
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-8">
        <Tabs defaultValue={tab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview" data-agent-id="tab-overview">
              Overview
            </TabsTrigger>
            <TabsTrigger value="transactions">Money</TabsTrigger>
            <TabsTrigger value="sessions" data-agent-id="tab-sessions">Sessions</TabsTrigger>
            <TabsTrigger value="salary">Salary</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex flex-col gap-4 pt-4">
            <Card>
              <CardContent className="flex flex-col gap-1 text-sm">
                <p className="text-muted-foreground">{operator.mobile}</p>
                {operator.address && <p className="text-muted-foreground">{operator.address}</p>}
                <p className="mt-2 flex items-center justify-between">
                  <span className="text-muted-foreground">Monthly Salary</span>
                  <span className="text-lg font-bold">{formatCurrency(operator.defaultMonthlySalary)}</span>
                </p>
              </CardContent>
            </Card>

            <SessionSummaryCard operatorId={operator.id} />

            {/* What the assistant reads aloud when asked about someone's pay,
                and what proves the salary screen actually loaded. */}
            <Card data-agent-id="salary-summary">
              <CardContent className="flex flex-col gap-2 text-sm">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Since Joining ({formatDateRange(lifetimeSalary.joiningDate, lifetimeSalary.asOf)})
                </p>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Payable Salary</span>
                  <span className="font-semibold">{formatCurrency(lifetimeSalary.totalPayable)}</span>
                </div>
                {lifetimeSalary.unpaidLeave > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Unpaid Leave (already deducted)</span>
                    <span className="font-semibold text-destructive">
                      -{formatCurrency(lifetimeSalary.unpaidLeave)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Salary Given</span>
                  <span className="font-semibold">{formatCurrency(lifetimeSalary.totalPaid)}</span>
                </div>
                <div className="flex justify-between border-t pt-2 text-base">
                  <span className="font-semibold">
                    Remaining {lifetimeSalary.remaining < 0 ? "(overpaid)" : ""}
                  </span>
                  <span
                    className={cn(
                      "font-bold",
                      lifetimeSalary.remaining > 0 && "text-working",
                      lifetimeSalary.remaining < 0 && "text-destructive",
                    )}
                  >
                    {formatCurrency(lifetimeSalary.remaining)}
                  </span>
                </div>
                <SalaryBreakdownDialog lifetimeSalary={lifetimeSalary} />
              </CardContent>
            </Card>

            <OperatorPinCard operatorId={operator.id} canLogin={operator.canLogin} hasPinSet={operator.hasPin} />
          </TabsContent>

          <TabsContent
            value="transactions"
            data-agent-id="transactions-list"
            className="flex flex-col gap-4 pt-4"
          >
            <AddTransactionDialog operatorId={operator.id} categories={categories} suggestedAmount={suggestedAmount} />
            {transactions.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">No transactions yet.</CardContent>
              </Card>
            )}
            {transactions.map((tx) => (
              <Card key={tx.id}>
                <CardContent className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{tx.category?.name ?? "Other"}</p>
                    <p className="text-sm text-muted-foreground">{formatDate(tx.date)}</p>
                    {tx.notes && <p className="text-sm text-muted-foreground">{tx.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="text-right">
                      <p className="font-bold">{formatCurrency(tx.amount)}</p>
                      <Badge variant="outline" className="text-xs">
                        {tx.deductFromSalary ? "Deducted" : "Not deducted"}
                      </Badge>
                    </div>
                    <EditTransactionDialog transaction={tx} categories={categories} />
                    <DeleteTransactionButton operatorId={operator.id} transactionId={tx.id} />
                  </div>
                </CardContent>
              </Card>
            ))}
            {loadMoreError && <p role="alert" className="text-sm font-medium text-destructive">{loadMoreError}</p>}
            {nextCursor && (
              <Button type="button" variant="outline" className="h-11" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? "Loading..." : "Load more"}
              </Button>
            )}
          </TabsContent>

          <TabsContent value="sessions" className="flex flex-col gap-4 pt-4">
            <SessionsPanel operatorId={operator.id} />
          </TabsContent>

          <TabsContent value="salary" className="flex flex-col gap-4 pt-4">
            <Card>
              <CardContent className="flex items-center justify-between">
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Previous month"
                  nativeButton={false}
                  render={
                    <Link
                      href={`/operators/detail?id=${id}&tab=salary&month=${prevMonth.getFullYear()}-${prevMonth.getMonth() + 1}`}
                    />
                  }
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <p className="font-semibold">{MONTH_LABEL.format(salaryDate)}</p>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Next month"
                  nativeButton={false}
                  render={
                    <Link
                      href={`/operators/detail?id=${id}&tab=salary&month=${nextMonth.getFullYear()}-${nextMonth.getMonth() + 1}`}
                    />
                  }
                >
                  <ChevronRight className="size-4" />
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Monthly Salary</span>
                  <span className="font-semibold">{formatCurrency(salary.baseSalary)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bonus / Incentive</span>
                  <span className="font-semibold text-working">+{formatCurrency(salary.bonus)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Deductions</span>
                  <span className="font-semibold text-destructive">-{formatCurrency(salary.deductions)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Already Paid</span>
                  <span className="font-semibold">-{formatCurrency(salary.alreadyPaid)}</span>
                </div>
                {salary.carriedForward !== 0 && (
                  <div className="flex justify-between border-t pt-2">
                    <span className="text-muted-foreground">
                      Carried Forward {salary.carriedForward > 0 ? "(unpaid earlier)" : "(overpaid earlier)"}
                    </span>
                    <span className={cn("font-semibold", salary.carriedForward > 0 ? "text-working" : "text-destructive")}>
                      {salary.carriedForward > 0 ? "+" : ""}
                      {formatCurrency(salary.carriedForward)}
                    </span>
                  </div>
                )}
                <div className="mt-2 flex justify-between border-t pt-2 text-base">
                  <span className="font-semibold">Remaining Payable</span>
                  <span className="font-bold">{formatCurrency(salary.payable)}</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="flex flex-col gap-3 pt-4">
            {pastWork.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">No past work yet.</CardContent>
              </Card>
            )}
            {pastWork.map((w) => (
              <Card key={w.id}>
                <CardContent className="flex flex-col gap-1">
                  <p className="font-bold">{w.excavator.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {w.customer.name} — {w.site.name}
                  </p>
                  <div className="flex items-center justify-between text-sm">
                    <span>{formatDateRange(w.startDate, w.endDate)}</span>
                    <span className="font-semibold">{formatHours(w.totalHours)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
