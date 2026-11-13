"use client";

import Link from "next/link";
import useSWR from "swr";
import {
  Banknote,
  Clock,
  IndianRupee,
  LineChart,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import type {
  getDashboardSummary,
  getMachineHoursDetail,
  getMonthlyHoursTrend,
  getMonthlyRevenueTrend,
  getPaymentCollectionStatus,
  getProfitOverview,
  getRecentActivity,
  getTopCustomersByRevenue,
} from "@/lib/services/dashboard";
import type { Plain } from "@/lib/plain";
import { swrFetcher } from "@/lib/api-client";
import { formatCurrency, formatCurrencyCompact } from "@/lib/utils/currency";
import { SummaryCard } from "@/components/dashboard/summary-card";
import { AlertBanner } from "@/components/dashboard/alert-banner";
import { MonthlyBarChart } from "@/components/dashboard/monthly-bar-chart";
import { HoursDetailButton } from "@/components/dashboard/hours-detail-button";
import { ProfitOverview } from "@/components/dashboard/profit-overview";
import { PaymentCollectionStatus } from "@/components/dashboard/payment-collection-status";
import { TopCustomers } from "@/components/dashboard/top-customers";
import { RecentActivityCard } from "@/components/dashboard/recent-activity-card";
import { SectionTitle } from "@/components/dashboard/section-title";
import { usePageTitle } from "@/components/page-title";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import Loading from "../loading";

type Summary = Plain<Awaited<ReturnType<typeof getDashboardSummary>>>;
type DashboardData = {
  cards: Summary["cards"];
  alerts: Summary["alerts"];
  ownerName: Summary["ownerName"];
  hoursTrend: Plain<Awaited<ReturnType<typeof getMonthlyHoursTrend>>>;
  revenueTrend: Plain<Awaited<ReturnType<typeof getMonthlyRevenueTrend>>>;
  activity: Plain<Awaited<ReturnType<typeof getRecentActivity>>>;
  machineHours: Plain<Awaited<ReturnType<typeof getMachineHoursDetail>>>;
  paymentCollection: Plain<Awaited<ReturnType<typeof getPaymentCollectionStatus>>>;
  profit: Plain<Awaited<ReturnType<typeof getProfitOverview>>>;
  topCustomers: Plain<Awaited<ReturnType<typeof getTopCustomersByRevenue>>>;
};

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  // No dedupingInterval override — the server computes this fresh on every
  // call (no server-side cache), so there's no reason to hold onto a client
  // copy longer than SWR's own short default dedup window.
  const { data } = useSWR<DashboardData>("/api/dashboard", swrFetcher);
  usePageTitle("Dashboard");

  if (!data) return <Loading />;

  const { cards, alerts, ownerName, hoursTrend, revenueTrend, activity, machineHours, paymentCollection, profit, topCustomers } =
    data;
  const firstName = ownerName.split(" ")[0];

  return (
    <div className="flex flex-col gap-6 px-4 py-5 md:px-8 md:py-8">
      {/* Greeting */}
      <div className="animate-fade-in-up">
        <h1 className="bg-gradient-to-r from-primary-text to-[#c2710a] bg-clip-text text-3xl dark:from-primary dark:to-golden font-extrabold tracking-tight text-transparent sm:text-4xl">
          {greeting()}, {firstName} <span aria-hidden="true">👋</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          Here&rsquo;s what&rsquo;s happening with your excavator business today.
        </p>
      </div>

      <AlertBanner alerts={alerts} />

      {/* Critical KPIs */}
      <div
        data-agent-id="dashboard-cards"
        className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5"
      >
        <Link href="/customers" className="block">
          <SummaryCard icon={Users} label="Total Customers" value={cards.totalCustomers} accent="default" />
        </Link>
        <SummaryCard
          icon={IndianRupee}
          label="Monthly Revenue"
          value={formatCurrencyCompact(cards.revenueThisMonth)}
          exactValue={formatCurrency(cards.revenueThisMonth)}
          trendPct={cards.revenueTrendPct}
          accent="success"
        />
        <SummaryCard
          icon={Banknote}
          label="Amount Received"
          value={formatCurrencyCompact(cards.amountReceived)}
          exactValue={formatCurrency(cards.amountReceived)}
          accent="info"
        />
        <SummaryCard
          icon={Wallet}
          label="Total Amount"
          value={formatCurrencyCompact(cards.totalRevenueAllTime)}
          exactValue={formatCurrency(cards.totalRevenueAllTime)}
          accent="premium"
        />
        <SummaryCard
          icon={Clock}
          label="Hours This Month"
          value={cards.hoursThisMonth}
          trendPct={cards.hoursTrendPct}
          action={<HoursDetailButton machines={machineHours} />}
          accent="info"
        />
      </div>

      {/* Profit Overview + Payment Collection */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <Card className="animate-fade-in-up">
          <CardHeader>
            <SectionTitle icon={LineChart} tone="premium">
              Business Profit Overview
            </SectionTitle>
          </CardHeader>
          <CardContent>
            <ProfitOverview {...profit} />
          </CardContent>
        </Card>
        <Card className="animate-fade-in-up">
          <CardHeader>
            <SectionTitle icon={Wallet} tone="info">
              Payment Collection Status
            </SectionTitle>
          </CardHeader>
          <CardContent>
            <PaymentCollectionStatus {...paymentCollection} />
          </CardContent>
        </Card>
      </div>

      {/* Trend charts */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <Card className="animate-fade-in-up">
          <CardHeader>
            <SectionTitle icon={IndianRupee} tone="success">
              Revenue — Last 6 Months
            </SectionTitle>
          </CardHeader>
          <CardContent>
            <MonthlyBarChart data={revenueTrend} dataKey="revenue" seriesLabel="Revenue" valueKind="currency" />
          </CardContent>
        </Card>
        <Card className="animate-fade-in-up">
          <CardHeader>
            <SectionTitle icon={Clock} tone="info">
              Working Hours — Last 6 Months
            </SectionTitle>
          </CardHeader>
          <CardContent>
            <MonthlyBarChart data={hoursTrend} dataKey="hours" seriesLabel="Hours" valueKind="hours" />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <RecentActivityCard events={activity} />
        <Card className="animate-fade-in-up">
          <CardHeader>
            <SectionTitle icon={Trophy} tone="success">
              Top Customers
            </SectionTitle>
          </CardHeader>
          <CardContent>
            {topCustomers.length > 0 ? (
              <TopCustomers customers={topCustomers} />
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">No billed customers yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
