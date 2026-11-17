import { db } from "@/lib/db";
import { dec, round2, sum, toNumber } from "@/lib/money";
import { billTotalsByCustomer } from "@/lib/services/financials";
import { getSiteTotals } from "@/lib/services/siteAnalysis";
import { computeServiceStatus } from "@/lib/services/serviceStatus";
import { getSalaryBreakdownForMonth, getTotalSalaryDue } from "@/lib/services/salary";
import { currentMonthRange } from "@/lib/utils/dates";

const TREND_MONTHS = 6;

/** Registration number is optional — omit the parenthetical entirely
 * rather than printing "(null)" in an alert message. */
function machineLabel(name: string, machineNumber: string | null) {
  return machineNumber ? `${name} (${machineNumber})` : name;
}

const COMPONENT_ALERT_LEAD_HOURS = 15;
const COMPONENT_ALERTS_LIMIT = 8;

/**
 * Per-component predictive maintenance check — cross-references each
 * machine's live hour meter against every catalog component that has a
 * configured interval (see GUIDE_INTERVAL_HOURS in serviceRecords.ts,
 * sourced from the general excavator maintenance interval guide), using
 * whichever service record last actually serviced that specific component
 * (falling back to the machine's starting hour meter if it never has been).
 * Surfaces a warning starting COMPONENT_ALERT_LEAD_HOURS before the
 * projected due hour, and a danger once past it — this is what feeds "tell
 * admin ahead of time this part needs checking" into the alert feed. Always
 * computed live off current data rather than on a fixed schedule, so it's
 * automatically fresh whenever the admin actually looks (dashboard load,
 * machine going idle, evening check-in — all just page views of the same
 * live numbers).
 *
 * A component with no service history at all projects forward from the
 * machine's *current* hour meter, not its starting one — servicing this
 * granular wasn't necessarily tracked in the app before today, so assuming
 * it was neglected since hour 0 would flood a machine with years of
 * untracked history in false "overdue" alerts the moment this feature
 * ships. Once a real service is logged for a component, its actual hour
 * meter takes over and drives the real projection from then on.
 */
async function getComponentMaintenanceAlerts(businessId: string) {
  const [excavators, catalog, serviceRecordItems] = await Promise.all([
    db.excavator.findMany({
      where: { businessId, isArchived: false },
      select: { id: true, name: true, machineNumber: true, currentHourMeter: true },
    }),
    db.serviceItem.findMany({
      where: { businessId, defaultIntervalHours: { not: null } },
      select: { id: true, name: true, defaultIntervalHours: true },
    }),
    db.serviceRecordItem.findMany({
      where: { done: true, serviceRecord: { businessId } },
      select: {
        serviceItemId: true,
        serviceRecord: { select: { excavatorId: true, hourMeterAtService: true, serviceDate: true } },
      },
      orderBy: { serviceRecord: { serviceDate: "desc" } },
    }),
  ]);

  if (excavators.length === 0 || catalog.length === 0) return [];

  // Most recent (first seen, since sorted desc) hour meter this exact
  // component was actually serviced at, per machine.
  const lastServicedHour = new Map<string, number>();
  for (const sri of serviceRecordItems) {
    const key = `${sri.serviceRecord.excavatorId}:${sri.serviceItemId}`;
    if (!lastServicedHour.has(key)) lastServicedHour.set(key, sri.serviceRecord.hourMeterAtService);
  }

  const due: { level: "warning" | "danger"; message: string; href: string; dueInHours: number }[] = [];
  for (const excavator of excavators) {
    for (const item of catalog) {
      if (item.defaultIntervalHours == null) continue;
      const lastHour = lastServicedHour.get(`${excavator.id}:${item.id}`) ?? excavator.currentHourMeter;
      const dueAtHour = lastHour + item.defaultIntervalHours;
      const dueInHours = Math.round((dueAtHour - excavator.currentHourMeter) * 100) / 100;
      if (dueInHours > COMPONENT_ALERT_LEAD_HOURS) continue;

      const label = machineLabel(excavator.name, excavator.machineNumber);
      due.push({
        level: dueInHours < 0 ? "danger" : "warning",
        message:
          dueInHours < 0
            ? `${item.name} on ${label} is overdue for service/inspection by ${Math.abs(dueInHours)} hrs`
            : `${item.name} on ${label} needs service/inspection soon — due in ${dueInHours} hrs`,
        href: `/excavators/detail?id=${excavator.id}&tab=service`,
        dueInHours,
      });
    }
  }

  return due
    .sort((a, b) => a.dueInHours - b.dueInHours)
    .slice(0, COMPONENT_ALERTS_LIMIT)
    .map(({ level, message, href }) => ({ level, message, href }));
}

/** Full alert list for the header bell dropdown — same shape as
 * getDashboardSummary's alerts, but computed standalone (no revenue/payment
 * aggregates) since every page renders the bell, not just the dashboard.
 * Idle-machine notices are deliberately excluded — those live on the
 * machine's own detail page instead, not in the global feed. */
export async function getAlerts(businessId: string) {
  const [business, excavators, pendingLogsCount, pendingWorkRequestsCount, activeWorkRequests, componentAlerts] =
    await Promise.all([
      db.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { defaultServiceIntervalHrs: true, maintenanceAlertThresholdHrs: true },
      }),
      db.excavator.findMany({
        where: { businessId, isArchived: false },
        select: {
          id: true,
          name: true,
          machineNumber: true,
          currentHourMeter: true,
          startingHourMeter: true,
          serviceIntervalHrs: true,
          serviceRecords: { orderBy: { serviceDate: "desc" }, take: 1, select: { hourMeterAtService: true, nextServiceDueHour: true } },
        },
      }),
      db.dailyWorkLog.count({ where: { status: "PENDING", workSession: { businessId } } }),
      db.operatorWorkRequest.count({ where: { status: "PENDING", businessId } }),
      db.operatorWorkRequest.findMany({
        where: { status: "ACTIVE", businessId },
        select: {
          excavatorId: true,
          excavator: { select: { name: true, machineNumber: true } },
          operator: { select: { name: true } },
          startHourMeter: true,
        },
      }),
      // Run alongside the rest instead of after — it doesn't depend on any
      // of these results, so there's no reason to pay for it as a second
      // sequential round-trip.
      getComponentMaintenanceAlerts(businessId),
    ]);

  const alerts: { level: "warning" | "danger"; message: string; href: string }[] = [];
  if (pendingLogsCount > 0) {
    alerts.push({
      level: "warning",
      message: `${pendingLogsCount} operator reading${pendingLogsCount === 1 ? "" : "s"} waiting for approval`,
      href: "/operators/approvals",
    });
  }
  if (pendingWorkRequestsCount > 0) {
    alerts.push({
      level: "warning",
      message: `${pendingWorkRequestsCount} operator-reported job${pendingWorkRequestsCount === 1 ? "" : "s"} waiting for approval`,
      href: "/operators/approvals",
    });
  }
  for (const req of activeWorkRequests) {
    alerts.push({
      level: "warning",
      message: `${machineLabel(req.excavator.name, req.excavator.machineNumber)} started by ${req.operator.name} at ${req.startHourMeter} hrs`,
      href: `/excavators/detail?id=${req.excavatorId}`,
    });
  }
  for (const excavator of excavators) {
    const lastService = excavator.serviceRecords[0] ?? null;
    const serviceStatus = computeServiceStatus({
      currentHourMeter: excavator.currentHourMeter,
      startingHourMeter: excavator.startingHourMeter,
      serviceIntervalHrs: excavator.serviceIntervalHrs,
      businessDefaultIntervalHrs: business.defaultServiceIntervalHrs,
      lastServiceHourMeter: lastService?.hourMeterAtService,
      lastServiceNextDueHour: lastService?.nextServiceDueHour,
      dueSoonThresholdHrs: business.maintenanceAlertThresholdHrs,
    });
    const href = `/excavators/detail?id=${excavator.id}`;
    if (serviceStatus.overdue) {
      alerts.push({
        level: "danger",
        message: `${machineLabel(excavator.name, excavator.machineNumber)} service is overdue by ${Math.abs(serviceStatus.dueInHours)} hrs`,
        href,
      });
    } else if (serviceStatus.dueSoon) {
      alerts.push({
        level: "warning",
        message: `${machineLabel(excavator.name, excavator.machineNumber)} service due in ${serviceStatus.dueInHours} hrs`,
        href,
      });
    }
  }

  alerts.push(...componentAlerts);

  return alerts;
}

/** Backs the "Hours This Month" card's View Detail dialog — per-machine
 * breakdown of hours worked and which attachment(s) were reported in use,
 * for whichever WorkSessions overlap the current month. */
export async function getMachineHoursDetail(businessId: string) {
  const { start, end } = currentMonthRange();
  const excavators = await db.excavator.findMany({
    where: { businessId, isArchived: false },
    select: {
      id: true,
      name: true,
      machineNumber: true,
      workSessions: {
        where: {
          status: "COMPLETED",
          OR: [{ startDate: { gte: start, lte: end } }, { endDate: { gte: start, lte: end } }],
        },
        select: { totalHours: true, attachment: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return excavators.map((e) => {
    const byAttachment = new Map<string, number>();
    for (const s of e.workSessions) {
      const key = s.attachment?.trim() || "No attachment reported";
      byAttachment.set(key, (byAttachment.get(key) ?? 0) + s.totalHours);
    }
    return {
      id: e.id,
      name: e.name,
      machineNumber: e.machineNumber,
      hours: Math.round(e.workSessions.reduce((sum, s) => sum + s.totalHours, 0) * 100) / 100,
      // Hours broken down by whichever attachment(s) were actually reported
      // in use — a machine that only ever ran one attachment this month
      // (e.g. always "Chain") naturally ends up with a single-row
      // breakdown, not a forced Bucket/Breaker split.
      breakdown: [...byAttachment.entries()]
        .map(([attachment, hours]) => ({ attachment, hours: Math.round(hours * 100) / 100 }))
        .sort((a, b) => b.hours - a.hours),
    };
  });
}

/** Calendar day, with the time dropped — month buckets are day-based. */
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function getTrendMonths() {
  const now = new Date();
  return Array.from({ length: TREND_MONTHS }).map((_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (TREND_MONTHS - 1 - i), 1);
    return { year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleString("en-IN", { month: "short" }) };
  });
}

export async function getMonthlyHoursTrend(businessId: string) {
  const months = getTrendMonths();
  const rangeStart = new Date(months[0].year, months[0].month, 1);
  const last = months[months.length - 1]!;
  const rangeEnd = new Date(last.year, last.month + 1, 1);

  const [logs, sessionsWithoutLogs] = await Promise.all([
    db.dailyWorkLog.findMany({
      where: { workSession: { businessId }, date: { gte: rangeStart } },
      select: { date: true, hoursWorked: true },
    }),
    // A job billed straight off the start/end hour meter never gets a daily
    // log, so the query above cannot see it — counting only logs leaves this
    // chart flat for an owner who records work that way, while the Hours This
    // Month card (getHoursForSessionsOverlappingRange) counts both sources.
    db.workSession.findMany({
      where: {
        businessId,
        dailyLogs: { none: {} },
        totalHours: { gt: 0 },
        startDate: { lt: rangeEnd },
      },
      select: { startDate: true, endDate: true, totalHours: true },
    }),
  ]);

  // Such a job has no per-day breakdown, so its hours are spread evenly over
  // the days it ran: one spanning two months shows in both, and is still
  // counted exactly once across the series rather than in full in each.
  const directByMonth = new Map<string, number>();
  for (const s of sessionsWithoutLogs) {
    const from = startOfDay(s.startDate);
    const to = startOfDay(s.endDate ?? s.startDate);
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
    const perDay = s.totalHours / days;
    for (let i = 0; i < days; i++) {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
      if (d < rangeStart || d >= rangeEnd) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      directByMonth.set(key, (directByMonth.get(key) ?? 0) + perDay);
    }
  }

  return months.map(({ year, month, label }) => {
    const logged = logs
      .filter((log) => log.date.getFullYear() === year && log.date.getMonth() === month)
      .reduce((sum, log) => sum + log.hoursWorked, 0);
    const direct = directByMonth.get(`${year}-${month}`) ?? 0;
    return { month: label, hours: Math.round((logged + direct) * 100) / 100 };
  });
}

export async function getMonthlyRevenueTrend(businessId: string) {
  const months = getTrendMonths();
  const rangeStart = new Date(months[0].year, months[0].month, 1);
  const bills = await db.bill.findMany({
    where: { businessId, billDate: { gte: rangeStart } },
    select: { billDate: true, totalAmount: true },
  });

  return months.map(({ year, month, label }) => {
    const revenue = sum(
      bills
        .filter((b) => b.billDate.getFullYear() === year && b.billDate.getMonth() === month)
        .map((b) => b.totalAmount),
    );
    return { month: label, revenue: round2(revenue).toNumber() };
  });
}

/**
 * Sessions with daily logs are counted from those logs (bounded to the
 * range). Sessions billed straight off the start/end hour meter — no daily
 * log ever entered — have no per-day breakdown to bound, so their full
 * totalHours counts whenever the session itself overlaps the range. Either
 * path contributes each session's hours exactly once.
 */
async function getHoursForSessionsOverlappingRange(businessId: string, start: Date, end: Date) {
  const [loggedAgg, sessionsWithoutLogs] = await Promise.all([
    db.dailyWorkLog.aggregate({
      where: { workSession: { businessId }, date: { gte: start, lte: end } },
      _sum: { hoursWorked: true },
    }),
    db.workSession.findMany({
      where: {
        businessId,
        dailyLogs: { none: {} },
        OR: [{ startDate: { gte: start, lte: end } }, { endDate: { gte: start, lte: end } }],
      },
      select: { totalHours: true },
    }),
  ]);

  const loggedHours = loggedAgg._sum.hoursWorked ?? 0;
  const directHours = sessionsWithoutLogs.reduce((sum, s) => sum + s.totalHours, 0);
  return Math.round((loggedHours + directHours) * 100) / 100;
}

function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null; // nothing to meaningfully compare against
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export async function getDashboardSummary(businessId: string) {
  const { start, end } = currentMonthRange();
  const lastMonthEnd = new Date(start.getTime() - 1);
  const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);

  const [
    business,
    excavators,
    hoursThisMonth,
    hoursLastMonth,
    revenueAgg,
    revenueLastMonthAgg,
    receivedAgg,
    pendingBillsAgg,
    totalCustomers,
    allTimeAgg,
    pendingLogsCount,
    pendingWorkRequestsCount,
    activeWorkRequests,
    operatorSalaryDue,
    componentAlerts,
    siteTotals,
  ] = await Promise.all([
    db.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { defaultServiceIntervalHrs: true, maintenanceAlertThresholdHrs: true, ownerName: true },
    }),
    db.excavator.findMany({
      where: { businessId, isArchived: false },
      include: {
        serviceRecords: { orderBy: { serviceDate: "desc" }, take: 1 },
      },
    }),
    // Sums the actual work-session hours (not just DailyWorkLog rows) so a
    // session billed straight off the start/end hour meter — with no daily
    // log ever entered — still counts, instead of silently reading as 0.
    getHoursForSessionsOverlappingRange(businessId, start, end),
    getHoursForSessionsOverlappingRange(businessId, lastMonthStart, lastMonthEnd),
    db.bill.aggregate({
      where: { businessId, billDate: { gte: start, lte: end } },
      _sum: { totalAmount: true },
    }),
    db.bill.aggregate({
      where: { businessId, billDate: { gte: lastMonthStart, lte: lastMonthEnd } },
      _sum: { totalAmount: true },
    }),
    db.payment.aggregate({
      where: { businessId },
      _sum: { amount: true },
    }),
    // Totals of every unpaid/partial bill, summed in the database (exact
    // NUMERIC arithmetic) instead of loading each bill row.
    db.bill.aggregate({
      where: { businessId, status: { in: ["UNPAID", "PARTIAL"] } },
      _sum: { totalAmount: true, paidAmount: true },
      _count: true,
    }),
    db.customer.count({ where: { businessId, isArchived: false } }),
    db.bill.aggregate({ where: { businessId }, _sum: { totalAmount: true }, _count: true }),
    db.dailyWorkLog.count({ where: { status: "PENDING", workSession: { businessId } } }),
    db.operatorWorkRequest.count({ where: { status: "PENDING", businessId } }),
    db.operatorWorkRequest.findMany({
      where: { status: "ACTIVE", businessId },
      select: {
        excavatorId: true,
        excavator: { select: { name: true, machineNumber: true } },
        operator: { select: { name: true } },
        startHourMeter: true,
      },
    }),
    getTotalSalaryDue(businessId),
    // Run alongside the rest instead of after — see the same change in
    // getAlerts above for why.
    getComponentMaintenanceAlerts(businessId),
    // Site Analysis totals come from the Site Analysis service itself (no separate formulas here).
    getSiteTotals(businessId),
  ]);

  const revenueThisMonth = round2(revenueAgg._sum.totalAmount).toNumber();
  const revenueLastMonth = round2(revenueLastMonthAgg._sum.totalAmount).toNumber();
  const amountReceived = round2(receivedAgg._sum.amount).toNumber();
  const pendingPayments = round2(dec(pendingBillsAgg._sum.totalAmount).minus(dec(pendingBillsAgg._sum.paidAmount))).toNumber();

  /**
   * "Total Amount" = every rupee of work on the books, invoiced or not.
   *
   * It used to be the sum of Bill.totalAmount alone, which left out work that
   * has been done and approved but not billed yet. Site Analysis values that
   * work at the site rates and counts it in its own Revenue and Pending, so
   * the two screens disagreed: the owner saw ₹X pending on Site Analysis and a
   * home total that did not include it. Adding the unbilled part here closes
   * that gap — bills still carry the billed money (including direct bills,
   * which belong to no work session and so never appear in the Site Analysis
   * engine), and `unbilledRevenue` adds the rest exactly once.
   */
  const billedAllTime = round2(allTimeAgg._sum.totalAmount).toNumber();
  const totalRevenueAllTime = round2(dec(billedAllTime).plus(dec(siteTotals.unbilledRevenue))).toNumber();
  /** Of that total, what has not been collected — the figure Site Analysis
   * calls Pending, over the whole business. */
  const pendingAmount = round2(dec(totalRevenueAllTime).minus(dec(amountReceived))).toNumber();
  const revenueTrendPct = percentChange(revenueThisMonth, revenueLastMonth);
  const hoursTrendPct = percentChange(hoursThisMonth, hoursLastMonth);

  const excavatorsWithStatus = excavators.map((excavator) => {
    const lastService = excavator.serviceRecords[0] ?? null;
    const serviceStatus = computeServiceStatus({
      currentHourMeter: excavator.currentHourMeter,
      startingHourMeter: excavator.startingHourMeter,
      serviceIntervalHrs: excavator.serviceIntervalHrs,
      businessDefaultIntervalHrs: business.defaultServiceIntervalHrs,
      lastServiceHourMeter: lastService?.hourMeterAtService,
      lastServiceNextDueHour: lastService?.nextServiceDueHour,
      dueSoonThresholdHrs: business.maintenanceAlertThresholdHrs,
    });

    return { excavator, serviceStatus };
  });

  const cards = {
    totalExcavators: excavators.length,
    working: excavators.filter((e) => e.status === "WORKING").length,
    idle: excavators.filter((e) => e.status === "IDLE").length,
    underService: excavators.filter((e) => e.status === "SERVICE").length,
    hoursThisMonth,
    hoursTrendPct,
    revenueThisMonth,
    revenueTrendPct,
    amountReceived,
    pendingPayments,
    pendingBillsCount: pendingBillsAgg._count,
    totalCustomers,
    /**
     * NOTE this field's MEANING changed, not its name or type: it now includes
     * unbilled work. Additive in the ADR-0005 sense — no field was removed or
     * renamed and nothing breaks — but an installed APK showing "Total Amount"
     * will start showing the larger figure without being updated. That is the
     * intended behaviour: the complaint was that the home total disagreed with
     * Site Analysis, and an old install should stop disagreeing too.
     */
    totalRevenueAllTime,
    /** The two parts of it, so a screen that wants only invoiced money (or
     * only the unbilled part) does not have to re-derive either. */
    billedRevenueAllTime: billedAllTime,
    unbilledRevenueAllTime: siteTotals.unbilledRevenue,
    pendingAmount,
    totalBillsCount: allTimeAgg._count,
    upcomingServices: excavatorsWithStatus.filter((e) => e.serviceStatus.dueSoon).length,
    operatorSalaryDue: toNumber(operatorSalaryDue),
    pendingApprovalsCount: pendingLogsCount + pendingWorkRequestsCount,
  };

  const alerts: { level: "warning" | "danger"; message: string; href: string }[] = [];
  if (pendingLogsCount > 0) {
    alerts.push({
      level: "warning",
      message: `${pendingLogsCount} operator reading${pendingLogsCount === 1 ? "" : "s"} waiting for approval`,
      href: "/operators/approvals",
    });
  }
  if (pendingWorkRequestsCount > 0) {
    alerts.push({
      level: "warning",
      message: `${pendingWorkRequestsCount} operator-reported job${pendingWorkRequestsCount === 1 ? "" : "s"} waiting for approval`,
      href: "/operators/approvals",
    });
  }
  for (const req of activeWorkRequests) {
    alerts.push({
      level: "warning",
      message: `${machineLabel(req.excavator.name, req.excavator.machineNumber)} started by ${req.operator.name} at ${req.startHourMeter} hrs`,
      href: `/excavators/detail?id=${req.excavatorId}`,
    });
  }
  for (const { excavator, serviceStatus } of excavatorsWithStatus) {
    const href = `/excavators/detail?id=${excavator.id}`;
    if (serviceStatus.overdue) {
      alerts.push({
        level: "danger",
        message: `${machineLabel(excavator.name, excavator.machineNumber)} service is overdue by ${Math.abs(serviceStatus.dueInHours)} hrs`,
        href,
      });
    } else if (serviceStatus.dueSoon) {
      alerts.push({
        level: "warning",
        message: `${machineLabel(excavator.name, excavator.machineNumber)} service due in ${serviceStatus.dueInHours} hrs`,
        href,
      });
    }
  }

  alerts.push(...componentAlerts);

  return { cards, alerts, ownerName: business.ownerName, siteTotals };
}

export type ActivityEvent = {
  id: string;
  kind: "work-started" | "work-stopped" | "bill" | "payment";
  message: string;
  detail: string;
  at: Date;
};

/** A merged, most-recent-first feed built from real rows across WorkSession,
 * Bill and Payment — no fabricated clock-time events, just what's genuinely
 * on record (dated to the day; exact time-of-day isn't tracked). */
export async function getRecentActivity(businessId: string, limit = 8): Promise<ActivityEvent[]> {
  const [started, stopped, bills, payments] = await Promise.all([
    db.workSession.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        startDate: true,
        excavator: { select: { name: true } },
        site: { select: { name: true } },
        customer: { select: { name: true } },
      },
    }),
    db.workSession.findMany({
      where: { businessId, status: "COMPLETED" },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, updatedAt: true, totalHours: true, excavator: { select: { name: true } }, customer: { select: { name: true } } },
    }),
    db.bill.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, createdAt: true, billNumber: true, totalAmount: true, customer: { select: { name: true } } },
    }),
    db.payment.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, createdAt: true, amount: true, bill: { select: { billNumber: true, customer: { select: { name: true } } } } },
    }),
  ]);

  const events: ActivityEvent[] = [
    ...started.map((s) => ({
      id: `start-${s.id}`,
      kind: "work-started" as const,
      message: `${s.excavator.name} started work for ${s.customer.name}`,
      detail: s.site.name,
      at: s.createdAt,
    })),
    ...stopped.map((s) => ({
      id: `stop-${s.id}`,
      kind: "work-stopped" as const,
      message: `${s.excavator.name} finished a job for ${s.customer.name}`,
      detail: `${s.totalHours} hrs total`,
      at: s.updatedAt,
    })),
    ...bills.map((b) => ({
      id: `bill-${b.id}`,
      kind: "bill" as const,
      message: `Bill ${b.billNumber} generated for ${b.customer.name}`,
      detail: `₹${toNumber(b.totalAmount).toLocaleString("en-IN")}`,
      at: b.createdAt,
    })),
    ...payments.map((p) => ({
      id: `pay-${p.id}`,
      kind: "payment" as const,
      message: `₹${toNumber(p.amount).toLocaleString("en-IN")} received from ${p.bill.customer.name}`,
      detail: `Bill ${p.bill.billNumber}`,
      at: p.createdAt,
    })),
  ];

  return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/** "Operator Performance": each operator's activity over the current
 * calendar month — real counts only (work days, hours, pending/rejected
 * readings), no fabricated score. */
export async function getOperatorPerformance(businessId: string) {
  const { start, end } = currentMonthRange();

  const operators = await db.operator.findMany({
    where: { businessId, isArchived: false },
    orderBy: { name: "asc" },
    include: {
      assignedExcavators: { select: { name: true, machineNumber: true }, take: 1 },
    },
  });

  return Promise.all(
    operators.map(async (op) => {
      const [logs, pendingCount, rejectedCount] = await Promise.all([
        db.dailyWorkLog.findMany({
          where: {
            status: "APPROVED",
            date: { gte: start, lte: end },
            workSession: { businessId, operatorId: op.id },
          },
          select: { date: true, hoursWorked: true },
        }),
        db.dailyWorkLog.count({
          where: { status: "PENDING", workSession: { businessId, operatorId: op.id } },
        }),
        db.dailyWorkLog.count({
          where: {
            status: "REJECTED",
            date: { gte: start, lte: end },
            workSession: { businessId, operatorId: op.id },
          },
        }),
      ]);

      const workDays = new Set(logs.map((l) => l.date.toDateString())).size;
      const totalHours = Math.round(logs.reduce((sum, l) => sum + l.hoursWorked, 0) * 100) / 100;
      const avgHoursPerDay = workDays > 0 ? Math.round((totalHours / workDays) * 100) / 100 : 0;

      return {
        id: op.id,
        name: op.name,
        machineName: op.assignedExcavators[0]?.name ?? null,
        machineNumber: op.assignedExcavators[0]?.machineNumber ?? null,
        workDays,
        totalHours,
        avgHoursPerDay,
        pendingReadings: pendingCount,
        rejectedReadings: rejectedCount,
      };
    }),
  );
}

export type PaymentCollectionCustomer = { id: string; name: string; billed: number; paid: number; pending: number };

/** "Payment Collection": how many customers are fully paid vs. still owe
 * something, plus the totals for a stacked collected/pending progress bar
 * and the actual customer breakdown per bucket (shown on the dashboard only
 * once a bucket is tapped — see PaymentCollectionStatus). */
export async function getPaymentCollectionStatus(businessId: string) {
  // Per-customer billed/paid totals summed by the database (exact NUMERIC),
  // then one lookup for the names — no bill row ever loaded into memory.
  const perCustomer = await billTotalsByCustomer(businessId);
  const customers = perCustomer.length
    ? await db.customer.findMany({
        where: { businessId, id: { in: perCustomer.map((c) => c.customerId) } },
        select: { id: true, name: true, companyName: true },
      })
    : [];
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const paidCustomers: PaymentCollectionCustomer[] = [];
  const partialCustomers: PaymentCollectionCustomer[] = [];
  const overdueCustomers: PaymentCollectionCustomer[] = []; // "overdue" here = still owes, distinct bucket from "in progress" partial

  for (const row of perCustomer) {
    const customer = customerById.get(row.customerId);
    if (!customer) continue;
    const billed = dec(row._sum.totalAmount);
    const paid = dec(row._sum.paidAmount);
    const pending = billed.minus(paid);
    const entry: PaymentCollectionCustomer = {
      id: customer.id,
      name: customer.companyName ? `${customer.name} — ${customer.companyName}` : customer.name,
      billed: round2(billed).toNumber(),
      paid: round2(paid).toNumber(),
      pending: round2(pending).toNumber(),
    };
    if (pending.lte(0.01)) paidCustomers.push(entry);
    else if (paid.gt(0.01)) partialCustomers.push(entry);
    else overdueCustomers.push(entry);
  }

  // Name + id as the final tie-breakers keep the order deterministic.
  const byName = (a: PaymentCollectionCustomer, b: PaymentCollectionCustomer) =>
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  paidCustomers.sort((a, b) => b.billed - a.billed || byName(a, b));
  partialCustomers.sort((a, b) => b.pending - a.pending || byName(a, b));
  overdueCustomers.sort((a, b) => b.pending - a.pending || byName(a, b));

  const totalBilled = sum(perCustomer.map((c) => c._sum.totalAmount));
  const totalReceived = sum(perCustomer.map((c) => c._sum.paidAmount));

  return {
    paidCount: paidCustomers.length,
    partialCount: partialCustomers.length,
    overdueCount: overdueCustomers.length,
    totalBilled: round2(totalBilled).toNumber(),
    totalReceived: round2(totalReceived).toNumber(),
    totalPending: round2(totalBilled.minus(totalReceived)).toNumber(),
    paidCustomers,
    partialCustomers,
    overdueCustomers,
  };
}

const OVERDUE_GRACE_DAYS = 15;
const DAY_MS = 86400000;

/** "Overdue Payment Alert": unpaid/partially-paid bills, oldest (and
 * therefore most overdue) first. "Overdue by N days" is measured from the
 * bill date since there's no separate due-date field — a grace period
 * avoids flagging a bill that was only just issued. */
export async function getOverduePayments(businessId: string, limit = 5) {
  const now = Date.now();
  // daysOverdue = floor((now - billDate) / 1 day) - grace > 0, i.e. the bill is
  // at least (grace + 1) whole days old. Filtering and limiting in the query
  // (oldest first) returns exactly the rows the old load-everything-then-
  // filter approach did, without reading the rest.
  const oldestAllowed = new Date(now - (OVERDUE_GRACE_DAYS + 1) * DAY_MS);
  const bills = await db.bill.findMany({
    where: { businessId, status: { in: ["UNPAID", "PARTIAL"] }, billDate: { lte: oldestAllowed } },
    orderBy: [{ billDate: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      billNumber: true,
      billDate: true,
      totalAmount: true,
      paidAmount: true,
      customer: { select: { id: true, name: true } },
    },
  });

  return bills.map((b) => ({
    billId: b.id,
    billNumber: b.billNumber,
    customerId: b.customer.id,
    customerName: b.customer.name,
    pending: round2(dec(b.totalAmount).minus(dec(b.paidAmount))).toNumber(),
    daysOverdue: Math.floor((now - b.billDate.getTime()) / DAY_MS) - OVERDUE_GRACE_DAYS,
  }));
}

/** "Top Customers": ranked by all-time revenue, with how much of that is
 * still outstanding. */
export async function getTopCustomersByRevenue(businessId: string, limit = 5) {
  const perCustomer = await billTotalsByCustomer(businessId);

  const top = perCustomer
    .map((c) => ({
      customerId: c.customerId,
      revenue: round2(c._sum.totalAmount).toNumber(),
      received: round2(c._sum.paidAmount).toNumber(),
      pending: round2(dec(c._sum.totalAmount).minus(dec(c._sum.paidAmount))).toNumber(),
    }))
    .sort((a, b) => b.revenue - a.revenue || a.customerId.localeCompare(b.customerId))
    .slice(0, limit);
  if (top.length === 0) return [];

  const customers = await db.customer.findMany({
    where: { businessId, id: { in: top.map((t) => t.customerId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(customers.map((c) => [c.id, c.name]));

  return top.map((t) => ({
    customerId: t.customerId,
    name: nameById.get(t.customerId) ?? "",
    revenue: t.revenue,
    received: t.received,
    pending: t.pending,
  }));
}

/** "Business Profit Overview" for the current calendar month. Expenses are
 * only ever real, already-tracked figures — service costs (ServiceRecord)
 * and operator salary (base + bonus, the accrued monthly cost of having
 * them on payroll, not just what's still unpaid). Fuel/repairs aren't
 * tracked anywhere in the app yet, so they're deliberately left out rather
 * than guessed. */
export async function getProfitOverview(businessId: string) {
  const { start, end } = currentMonthRange();

  const [revenueAgg, serviceAgg, salaryBreakdown] = await Promise.all([
    db.bill.aggregate({ where: { businessId, billDate: { gte: start, lte: end } }, _sum: { totalAmount: true } }),
    db.serviceRecord.aggregate({
      where: { businessId, serviceDate: { gte: start, lte: end } },
      _sum: { cost: true },
    }),
    getSalaryBreakdownForMonth(businessId, start.getFullYear(), start.getMonth()),
  ]);

  const revenue = round2(revenueAgg._sum.totalAmount);
  const serviceCost = round2(serviceAgg._sum.cost);
  // dec() accepts the salary service's amounts whether it hands back numbers or Decimals.
  const salaryCost = round2(sum(salaryBreakdown.map((op) => dec(op.baseSalary).plus(dec(op.bonus)))));

  const expenses = round2(serviceCost.plus(salaryCost));
  const netProfit = round2(revenue.minus(expenses));
  // A percentage, not money: computed from the exact 2-dp figures, rounded to 1 dp.
  const profitMarginPct = revenue.gt(0) ? Math.round((netProfit.toNumber() / revenue.toNumber()) * 1000) / 10 : 0;

  return {
    revenue: revenue.toNumber(),
    expenses: expenses.toNumber(),
    netProfit: netProfit.toNumber(),
    profitMarginPct,
    breakdown: [
      { label: "Operator Salary", amount: salaryCost.toNumber() },
      { label: "Service & Maintenance", amount: serviceCost.toNumber() },
    ].filter((b) => b.amount > 0),
  };
}
