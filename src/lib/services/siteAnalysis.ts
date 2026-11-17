import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-error";
import { dec, round2 } from "@/lib/money";
import { BILL_PAID_FRACTION_SQL, getCustomerBillTotals, type BillTotals } from "@/lib/services/financials";

/**
 * Site Analysis: the ONE place that turns work records into per-site / per-machine / per-day figures.
 * The Site Analysis pages, /api/sites*, the customer site card and the dashboard "Site Analysis"
 * totals all call into this file, so no screen has a formula of its own.
 *
 * ---------------------------------------------------------------------------------------------
 * WORK ENTRIES (single source of truth, built in SQL by `entriesCte`)
 *   - every APPROVED DailyWorkLog (PENDING / REJECTED never count). A DIESEL_ONLY log counts its
 *     diesel and 0 hours.
 *   - every WorkSession that has NO daily logs at all (operator job flow) = ONE entry dated
 *     session.startDate with hours = totalHours, attachment = session.attachment, diesel =
 *     session.dieselLiters. (A running job with 0 hours and no diesel is skipped.)
 *     Sessions WITH logs are counted only through their logs, so session-level diesel (which is
 *     rolled up from the logs) is never added twice.
 *
 * WORK TYPE: attachment containing "bucket" -> BUCKET, "breaker"/"brekar" -> BREAKER (the
 * AttachmentPicker values are Bucket / Breaker / Chaining); anything else (Chaining, empty) ->
 * OTHER: its hours are shown but it is unpriced.
 *
 * REVENUE (per entry)
 *   - session already BILLED (a BillItem points at it): the entry carries its share of
 *     BillItem.amount (amount x entry hours / session hours), so billed work always equals the real
 *     invoice and a later rate change can never alter it.
 *   - otherwise hours x the rate in force on the work date: the latest SiteRateHistory row with
 *     effectiveFrom <= the date (work before the first row uses the first row; a site with no
 *     history rows falls back to the site's current rate). OTHER work is 0.
 *   Total Revenue = billed (BillItem amounts) + unbilled work valued at site rates
 *   (exposed separately as billedRevenue / unbilledRevenue).
 *
 * RECEIVED = payments allocated to the site's bill items proportionally:
 *   item share x bill.paidAmount / bill.totalAmount (financials.ts).
 * PENDING  = Revenue - Received  (e.g. 5,82,000 - 4,62,000 = 1,20,000). Unbilled work is pending.
 * Customer-level figures (billed/received/pending across ALL of a customer's bills) come from the
 * same Bill/Payment records through financials.ts and are shown beside, never added to, site figures.
 *
 * The dashboard's "Total Amount" is kept consistent with this: it adds `unbilledRevenue` from
 * getSiteTotals() to its own bill totals, so the Pending shown on Site Analysis is part of the
 * home-screen total rather than missing from it. Bills carry the billed money (including direct
 * bills, which belong to no work session and so never reach this engine), and the unbilled part is
 * added exactly once. See getDashboardSummary.
 *
 * DIESEL AVERAGE comes in two forms, and both are shown:
 *   - simple (simpleDieselAverage): diesel taken / hours worked, and the same sum inverted as hours
 *     per litre. Needs no tank readings, so it is always available.
 *   - exact (consumptionPerHour / dieselEntryAverage): diesel actually BURNED per hour, which needs
 *     the litres left in the tank. Null until those are entered — which is why the simple form
 *     exists rather than the screen showing nothing.
 *
 * MACHINES WORKING AT A SITE: an Excavator with status WORKING (not archived) whose
 * currentSiteId is the site OR which has an ACTIVE WorkSession at the site. Dashboard
 * "machines working" counts distinct such machines.
 *
 * DAILY READING ROW: one row per (day, machine). Total Hours = meter hours (end - start) per entry
 * when both meters exist and end >= start, otherwise the entry's recorded hoursWorked (a stored
 * end < start is flagged, and hoursWorked is used). Bucket / Brekar / Other hours are the recorded
 * hours split by attachment. Reading Difference = Total Hours - (Bucket + Brekar), i.e. meter
 * hours not assigned to Bucket or Brekar (Chaining / other / not specified). "Average" = diesel litres
 * per working hour of that row. All figures are tenant-scoped by businessId.
 * ---------------------------------------------------------------------------------------------
 */

export const DEFAULT_PAGE_SIZE = 20;

export type SiteAnalysisFilters = {
  from?: string;
  to?: string;
  excavatorId?: string;
};

type Scope = {
  businessId: string;
  /** SQL condition on alias `st` (Site) narrowing the sites considered. */
  siteCond?: Prisma.Sql;
  excavatorId?: string;
  from?: Date;
  to?: Date;
};

/** Same window convention as the customers module: the day's UTC midnight to the last ms of that day. */
export function parseRange(from?: string, to?: string) {
  return {
    from: from ? new Date(from) : undefined,
    to: to ? new Date(`${to}T23:59:59.999`) : undefined,
  };
}

const money = (v: unknown) => round2(dec(v as string | number | null)).toNumber();
const num = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

/** Everything up to and including `val`: one row per work entry with its type and valuation. */
function entriesCte(scope: Scope): Prisma.Sql {
  const b = scope.businessId;
  const siteCond = scope.siteCond ? Prisma.sql`AND ${scope.siteCond}` : Prisma.empty;
  const machineCond = scope.excavatorId ? Prisma.sql`AND s."excavatorId" = ${scope.excavatorId}` : Prisma.empty;
  return Prisma.sql`
    WITH base AS (
      SELECT l.id AS "entryId", 'LOG'::text AS src, s.id AS "sessionId", s."siteId", s."excavatorId", s."operatorId",
             l."operatorName" AS "operatorLabel", l.date AS date,
             l."startHourMeter" AS "startMeter", l."endHourMeter" AS "endMeter",
             (CASE WHEN l.kind = 'DIESEL_ONLY' THEN 0 ELSE round(l."hoursWorked"::numeric, 2) END) AS hours,
             l.attachment AS attachment,
             round(COALESCE(l."dieselLiters", 0)::numeric, 2) AS diesel,
             l."remainingDieselLiters" AS closing,
             l."createdAt" AS "enteredAt",
             l.notes AS notes
      FROM "DailyWorkLog" l
      JOIN "WorkSession" s ON s.id = l."workSessionId"
      JOIN "Site" st ON st.id = s."siteId"
      WHERE s."businessId" = ${b} AND st."businessId" = ${b} AND l.status = 'APPROVED' ${siteCond} ${machineCond}
      UNION ALL
      SELECT s.id, 'SESSION'::text, s.id, s."siteId", s."excavatorId", s."operatorId",
             NULL, s."startDate", s."startHourMeter", s."endHourMeter",
             round(s."totalHours"::numeric, 2), s.attachment,
             round(COALESCE(s."dieselLiters", 0)::numeric, 2), s."remainingDieselLiters", s."createdAt", s.notes
      FROM "WorkSession" s
      JOIN "Site" st ON st.id = s."siteId"
      WHERE s."businessId" = ${b} AND st."businessId" = ${b}
        AND NOT EXISTS (SELECT 1 FROM "DailyWorkLog" dl WHERE dl."workSessionId" = s.id)
        AND NOT (s.status = 'ACTIVE' AND s."totalHours" = 0 AND COALESCE(s."dieselLiters", 0) = 0)
        ${siteCond} ${machineCond}
    ),
    ent AS (
      SELECT x.*,
             (CASE WHEN lower(COALESCE(x.attachment, '')) LIKE '%bucket%' THEN 'BUCKET'
                   WHEN lower(COALESCE(x.attachment, '')) LIKE '%breaker%' OR lower(COALESCE(x.attachment, '')) LIKE '%brekar%' THEN 'BREAKER'
                   ELSE 'OTHER' END) AS wtype,
             sum(x.hours) OVER (PARTITION BY x."sessionId") AS "sessHours",
             count(*) OVER (PARTITION BY x."sessionId") AS "sessCnt"
      FROM base x
    ),
    pre AS (
      SELECT e.*,
             COALESCE(NULLIF(trim(e."operatorLabel"), ''), op.name) AS "operatorName",
             exc.name AS "excavatorName", exc."machineNumber" AS "machineNumber",
             (bi.id IS NOT NULL) AS billed,
             bi.amount AS "biAmount",
             ${BILL_PAID_FRACTION_SQL} AS "paidFrac",
             -- unbilled valuation: hours x the rate in force on the work date (OTHER is unpriced)
             (e.hours * COALESCE(
                CASE e.wtype
                  WHEN 'BUCKET' THEN (CASE WHEN r.id IS NULL THEN st."bucketRate" ELSE r."bucketRate" END)
                  WHEN 'BREAKER' THEN (CASE WHEN r.id IS NULL THEN st."breakerRate" ELSE r."breakerRate" END)
                  ELSE 0 END, 0)) AS uv
      FROM ent e
      JOIN "Site" st ON st.id = e."siteId"
      JOIN "Excavator" exc ON exc.id = e."excavatorId"
      JOIN "Operator" op ON op.id = e."operatorId"
      LEFT JOIN "BillItem" bi ON bi."workSessionId" = e."sessionId"
      LEFT JOIN "Bill" bl ON bl.id = bi."billId" AND bl."businessId" = ${b}
      LEFT JOIN LATERAL (
        SELECT h.id, h."bucketRate", h."breakerRate"
        FROM "SiteRateHistory" h
        WHERE h."siteId" = e."siteId" AND h."businessId" = ${b}
        ORDER BY (h."effectiveFrom" <= e.date) DESC,
                 CASE WHEN h."effectiveFrom" <= e.date THEN h."effectiveFrom" END DESC NULLS LAST,
                 h."effectiveFrom" ASC, h."createdAt" DESC
        LIMIT 1
      ) r ON TRUE
    ),
    pre2 AS (
      SELECT p.*,
             -- a billed session's invoice amount is split over its entries by their valuation
             -- (hours x rate), falling back to hours, then to an even split
             (CASE WHEN sum(p.uv) OVER (PARTITION BY p."sessionId") > 0 THEN p.uv / sum(p.uv) OVER (PARTITION BY p."sessionId")
                   WHEN p."sessHours" > 0 THEN p.hours / p."sessHours"
                   ELSE 1.0 / p."sessCnt" END) AS share
      FROM pre p
    ),
    val AS (
      SELECT q.*,
             (CASE WHEN q.billed THEN q."biAmount" * q.share ELSE q.uv END) AS revenue,
             (CASE WHEN q.billed THEN q."biAmount" * q.share * q."paidFrac" ELSE 0 END) AS received
      FROM pre2 q
    )`;
}

function dateCond(scope: Scope): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (scope.from) parts.push(Prisma.sql`date >= ${scope.from}::timestamp`);
  if (scope.to) parts.push(Prisma.sql`date <= ${scope.to}::timestamp`);
  return Prisma.join(parts, " AND ");
}

export type Totals = {
  machines: number;
  hours: number;
  bucketHours: number;
  breakerHours: number;
  otherHours: number;
  diesel: number;
  /** Distinct days with work hours. */
  workDays: number;
  /** Distinct days with any entry (hours or diesel). */
  dataDays: number;
  avgHoursPerDay: number;
  avgDieselPerDay: number;
  /** Litres per working hour; 0 when there are no hours. */
  avgDieselPerHour: number;
  revenue: number;
  billedRevenue: number;
  unbilledRevenue: number;
  received: number;
  pending: number;
  bucketRevenue: number;
  breakerRevenue: number;
  otherRevenue: number;
};

type AggRow = Record<string, unknown>;

const AGG_SELECT = Prisma.sql`
  count(DISTINCT "excavatorId")::int AS machines,
  COALESCE(sum(hours), 0)::float8 AS hours,
  COALESCE(sum(hours) FILTER (WHERE wtype = 'BUCKET'), 0)::float8 AS "bucketHours",
  COALESCE(sum(hours) FILTER (WHERE wtype = 'BREAKER'), 0)::float8 AS "breakerHours",
  COALESCE(sum(hours) FILTER (WHERE wtype = 'OTHER'), 0)::float8 AS "otherHours",
  COALESCE(sum(diesel), 0)::float8 AS diesel,
  (count(DISTINCT date::date) FILTER (WHERE hours > 0))::int AS "workDays",
  count(DISTINCT date::date)::int AS "dataDays",
  COALESCE(sum(revenue), 0)::text AS revenue,
  COALESCE(sum(revenue) FILTER (WHERE billed), 0)::text AS "billedRevenue",
  COALESCE(sum(received), 0)::text AS received,
  COALESCE(sum(revenue) FILTER (WHERE wtype = 'BUCKET'), 0)::text AS "bucketRevenue",
  COALESCE(sum(revenue) FILTER (WHERE wtype = 'BREAKER'), 0)::text AS "breakerRevenue",
  COALESCE(sum(revenue) FILTER (WHERE wtype = 'OTHER'), 0)::text AS "otherRevenue"`;

function toTotals(row: AggRow | undefined): Totals {
  const hours = num(row?.hours);
  const diesel = num(row?.diesel);
  const workDays = Number(row?.workDays ?? 0);
  const dataDays = Number(row?.dataDays ?? 0);
  const revenue = money(row?.revenue ?? 0);
  const billedRevenue = money(row?.billedRevenue ?? 0);
  const received = money(row?.received ?? 0);
  return {
    machines: Number(row?.machines ?? 0),
    hours,
    bucketHours: num(row?.bucketHours),
    breakerHours: num(row?.breakerHours),
    otherHours: num(row?.otherHours),
    diesel,
    workDays,
    dataDays,
    avgHoursPerDay: workDays > 0 ? num(hours / workDays) : 0,
    avgDieselPerDay: dataDays > 0 ? num(diesel / dataDays) : 0,
    avgDieselPerHour: hours > 0 ? num(diesel / hours) : 0,
    revenue,
    billedRevenue,
    unbilledRevenue: round2(dec(revenue).minus(dec(billedRevenue))).toNumber(),
    received,
    pending: round2(dec(revenue).minus(dec(received))).toNumber(),
    bucketRevenue: money(row?.bucketRevenue ?? 0),
    breakerRevenue: money(row?.breakerRevenue ?? 0),
    otherRevenue: money(row?.otherRevenue ?? 0),
  };
}

/** Totals over the scope with no grouping. */
async function aggregateAll(scope: Scope): Promise<Totals> {
  const rows = await db.$queryRaw<AggRow[]>(Prisma.sql`
    ${entriesCte(scope)}
    SELECT ${AGG_SELECT} FROM val WHERE ${dateCond(scope)}`);
  return toTotals(rows[0]);
}

async function aggregateBySite(scope: Scope): Promise<Map<string, Totals>> {
  const rows = await db.$queryRaw<AggRow[]>(Prisma.sql`
    ${entriesCte(scope)}
    SELECT "siteId", ${AGG_SELECT} FROM val WHERE ${dateCond(scope)} GROUP BY "siteId"`);
  return new Map(rows.map((r) => [r.siteId as string, toTotals(r)]));
}

export type MachineRow = Totals & {
  excavatorId: string;
  name: string;
  machineNumber: string | null;
  operatorName: string | null;
};

async function aggregateByMachine(scope: Scope): Promise<MachineRow[]> {
  const rows = await db.$queryRaw<AggRow[]>(Prisma.sql`
    ${entriesCte(scope)}
    SELECT "excavatorId", min("excavatorName") AS name, min("machineNumber") AS "machineNumber",
           (array_agg("operatorName" ORDER BY date DESC, "entryId") FILTER (WHERE "operatorName" IS NOT NULL))[1] AS "operatorName",
           ${AGG_SELECT}
    FROM val WHERE ${dateCond(scope)}
    GROUP BY "excavatorId"
    ORDER BY min("excavatorName"), "excavatorId"`);
  return rows.map((r) => ({
    ...toTotals(r),
    excavatorId: r.excavatorId as string,
    name: r.name as string,
    machineNumber: (r.machineNumber as string | null) ?? null,
    operatorName: (r.operatorName as string | null) ?? null,
  }));
}

async function lastWorkDates(scope: Scope): Promise<Map<string, string>> {
  const rows = await db.$queryRaw<{ siteId: string; last: string }[]>(Prisma.sql`
    ${entriesCte({ ...scope, from: undefined, to: undefined })}
    SELECT "siteId", to_char(max(date), 'YYYY-MM-DD') AS last FROM val WHERE hours > 0 GROUP BY "siteId"`);
  return new Map(rows.map((r) => [r.siteId, r.last]));
}

// ---------------------------------------------------------------------------------------------
// Machines currently working
// ---------------------------------------------------------------------------------------------

export type WorkingMachine = { id: string; name: string; machineNumber: string | null };

/** siteId -> machines currently working there (see header for the definition). One query. */
export async function getMachinesWorkingBySite(businessId: string, siteIds?: string[]) {
  const excavators = await db.excavator.findMany({
    where: { businessId, status: "WORKING", isArchived: false },
    select: {
      id: true,
      name: true,
      machineNumber: true,
      currentSiteId: true,
      workSessions: { where: { businessId, status: "ACTIVE" }, select: { siteId: true } },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const bySite = new Map<string, WorkingMachine[]>();
  const wanted = siteIds ? new Set(siteIds) : null;
  for (const ex of excavators) {
    const sites = new Set<string>(ex.workSessions.map((s) => s.siteId));
    if (ex.currentSiteId) sites.add(ex.currentSiteId);
    for (const siteId of sites) {
      if (wanted && !wanted.has(siteId)) continue;
      const list = bySite.get(siteId) ?? [];
      list.push({ id: ex.id, name: ex.name, machineNumber: ex.machineNumber });
      bySite.set(siteId, list);
    }
  }
  return bySite;
}

// ---------------------------------------------------------------------------------------------
// Site list
// ---------------------------------------------------------------------------------------------

export type SiteListFilters = {
  q?: string;
  type?: string;
  status?: string;
  excavatorId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

function escapeLike(v: string) {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function siteFilterCond(businessId: string, f: SiteListFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`st."businessId" = ${businessId}`];
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    parts.push(Prisma.sql`(st.name ILIKE ${like} OR COALESCE(st.address, '') ILIKE ${like} OR EXISTS (
      SELECT 1 FROM "Customer" c WHERE c.id = st."customerId" AND c."businessId" = ${businessId}
        AND (c.name ILIKE ${like} OR COALESCE(c."companyName", '') ILIKE ${like})))`);
  }
  if (f.type) parts.push(Prisma.sql`st.type = ${f.type}`);
  if (f.status) parts.push(Prisma.sql`st.status = ${f.status}`);
  if (f.excavatorId) {
    parts.push(Prisma.sql`(EXISTS (SELECT 1 FROM "WorkSession" ws WHERE ws."siteId" = st.id AND ws."businessId" = ${businessId}
        AND ws."excavatorId" = ${f.excavatorId})
      OR st.id IN (SELECT ex."currentSiteId" FROM "Excavator" ex WHERE ex.id = ${f.excavatorId} AND ex."businessId" = ${businessId}
        AND ex."currentSiteId" IS NOT NULL))`);
  }
  return Prisma.join(parts, " AND ");
}

export const SELF_SITE_LABEL = "Self Site";

type SiteRow = {
  id: string;
  name: string;
  type: string;
  status: string;
  address: string | null;
  customerId: string | null;
  customerName: string | null;
  version: number;
  bucketRate: string | null;
  breakerRate: string | null;
  total: number;
};

export async function listSites(businessId: string, f: SiteListFilters = {}) {
  const pageSize = f.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = f.page ?? 1;
  const { from, to } = parseRange(f.from, f.to);
  const cond = siteFilterCond(businessId, f);

  const pageRows = await db.$queryRaw<SiteRow[]>(Prisma.sql`
    SELECT st.id, st.name, st.type, st.status, st.address, st."customerId", c.name AS "customerName", st.version,
           st."bucketRate"::text AS "bucketRate", st."breakerRate"::text AS "breakerRate",
           count(*) OVER ()::int AS total
    FROM "Site" st
    LEFT JOIN "Customer" c ON c.id = st."customerId" AND c."businessId" = ${businessId}
    WHERE ${cond}
    ORDER BY lower(st.name), st.id
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
  const total = pageRows[0]?.total ?? (page > 1 ? await countSites(businessId, cond) : 0);
  const ids = pageRows.map((r) => r.id);

  const siteCondForIds = ids.length ? Prisma.sql`st.id IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`;
  const scopeBase: Scope = { businessId, excavatorId: f.excavatorId, from, to };
  const [perSite, lastDates, working, summary, machineOptions] = await Promise.all([
    ids.length ? aggregateBySite({ ...scopeBase, siteCond: siteCondForIds }) : Promise.resolve(new Map<string, Totals>()),
    ids.length ? lastWorkDates({ ...scopeBase, siteCond: siteCondForIds }) : Promise.resolve(new Map<string, string>()),
    getMachinesWorkingBySite(businessId, ids),
    // Cards over the WHOLE filtered list, not just this page.
    aggregateAll({ ...scopeBase, siteCond: cond }),
    // For the machine filter dropdown.
    db.excavator.findMany({
      where: { businessId, isArchived: false },
      select: { id: true, name: true, machineNumber: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
  ]);

  const empty = toTotals(undefined);
  const sites = pageRows.map((r) => {
    const t = perSite.get(r.id) ?? empty;
    const machines = working.get(r.id) ?? [];
    return {
      id: r.id,
      version: r.version,
      name: r.name,
      type: r.type,
      status: r.status,
      location: r.address,
      customerId: r.customerId,
      customerName: r.type === "SELF_SITE" ? SELF_SITE_LABEL : (r.customerName ?? "—"),
      bucketRate: r.bucketRate === null ? null : money(r.bucketRate),
      breakerRate: r.breakerRate === null ? null : money(r.breakerRate),
      machinesWorking: machines.length,
      machinesWorkingList: machines,
      totalHours: t.hours,
      revenue: t.revenue,
      received: t.received,
      pending: t.pending,
      lastWorkDate: lastDates.get(r.id) ?? null,
    };
  });

  return {
    sites,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    machineOptions,
    summary: {
      sites: total,
      totalHours: summary.hours,
      revenue: summary.revenue,
      received: summary.received,
      pending: summary.pending,
    },
  };
}

async function countSites(businessId: string, cond: Prisma.Sql) {
  const rows = await db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM "Site" st WHERE st."businessId" = ${businessId} AND ${cond}`);
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Dashboard totals (same engine, whole business)
// ---------------------------------------------------------------------------------------------

export type SiteTotals = {
  activeSites: number;
  machinesWorking: number;
  totalWorkHours: number;
  bucketHours: number;
  brekarHours: number;
  dieselLiters: number;
  revenue: number;
  /** The part of `revenue` that is on an invoice. */
  billedRevenue: number;
  /** Work done but not yet invoiced, valued at the site rates. Part of
   * `revenue` and of `pending`: the dashboard's "Total Amount" adds exactly
   * this to its bill totals so the home screen counts the same money Site
   * Analysis does (see getDashboardSummary). */
  unbilledRevenue: number;
  received: number;
  pending: number;
  /** "all-time" or the range these figures cover. */
  period: "all-time";
};

/** All-time totals across every site of the business. Computed by the same entries CTE as the
 * per-site views, so it always equals the sum of the site list. */
export async function getSiteTotals(businessId: string): Promise<SiteTotals> {
  const [totals, activeSites, working] = await Promise.all([
    aggregateAll({ businessId }),
    db.site.count({ where: { businessId, status: "ACTIVE" } }),
    getMachinesWorkingBySite(businessId),
  ]);
  const distinctMachines = new Set<string>();
  for (const list of working.values()) for (const m of list) distinctMachines.add(m.id);
  return {
    activeSites,
    machinesWorking: distinctMachines.size,
    totalWorkHours: totals.hours,
    bucketHours: totals.bucketHours,
    brekarHours: totals.breakerHours,
    dieselLiters: totals.diesel,
    revenue: totals.revenue,
    billedRevenue: totals.billedRevenue,
    unbilledRevenue: totals.unbilledRevenue,
    received: totals.received,
    pending: totals.pending,
    period: "all-time",
  };
}

// ---------------------------------------------------------------------------------------------
// Site detail / analysis
// ---------------------------------------------------------------------------------------------

export async function getSiteAnalysis(businessId: string, siteId: string, f: SiteAnalysisFilters = {}) {
  const site = await db.site.findFirst({
    where: { id: siteId, businessId },
    include: { customer: { select: { id: true, name: true, companyName: true, mobile: true } } },
  });
  if (!site) return null;

  let machine: { id: string; name: string; machineNumber: string | null; currentHourMeter: number; operatorName: string | null } | null = null;
  if (f.excavatorId) {
    const ex = await db.excavator.findFirst({
      where: { id: f.excavatorId, businessId },
      select: { id: true, name: true, machineNumber: true, currentHourMeter: true, currentOperator: { select: { name: true } } },
    });
    if (!ex) return null;
    machine = {
      id: ex.id,
      name: ex.name,
      machineNumber: ex.machineNumber,
      currentHourMeter: ex.currentHourMeter,
      operatorName: ex.currentOperator?.name ?? null,
    };
  }

  const { from, to } = parseRange(f.from, f.to);
  const scope: Scope = { businessId, siteCond: Prisma.sql`st.id = ${siteId}`, excavatorId: f.excavatorId, from, to };

  const [totals, machines, machineOptions, working, rateHistory, customerFinancials, dieselConsumption, closings] =
    await Promise.all([
    aggregateAll(scope),
    aggregateByMachine(scope),
    db.excavator.findMany({
      where: { businessId, OR: [{ workSessions: { some: { siteId, businessId } } }, { currentSiteId: siteId }] },
      select: { id: true, name: true, machineNumber: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    getMachinesWorkingBySite(businessId, [siteId]),
    db.siteRateHistory.findMany({
      where: { siteId, businessId },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      take: 10,
    }),
    site.customerId ? getCustomerBillTotals(businessId, site.customerId) : Promise.resolve<BillTotals | null>(null),
    f.excavatorId
      ? getDieselConsumptionStats(businessId, siteId, { ...f, excavatorId: f.excavatorId })
      : Promise.resolve(null),
    closingBalances(businessId, siteId, f.excavatorId),
  ]);

  const machineFilterId = f.excavatorId;
  const workingHere = (working.get(siteId) ?? []).filter((m) => !machineFilterId || m.id === machineFilterId);
  if (machine && machine.operatorName === null) {
    machine.operatorName = machines.find((m) => m.excavatorId === machine.id)?.operatorName ?? null;
  }

  return {
    site: {
      id: site.id,
      version: site.version,
      name: site.name,
      type: site.type,
      status: site.status,
      location: site.address,
      customerId: site.customerId,
      customerName: site.type === "SELF_SITE" ? SELF_SITE_LABEL : (site.customer?.name ?? "—"),
      customerCompany: site.customer?.companyName ?? null,
      /** So the shared PDF report can open the right WhatsApp chat. */
      customerMobile: site.customer?.mobile ?? null,
      bucketRate: site.bucketRate === null ? null : dec(site.bucketRate).toNumber(),
      breakerRate: site.breakerRate === null ? null : dec(site.breakerRate).toNumber(),
    },
    filters: { from: f.from ?? null, to: f.to ?? null, excavatorId: f.excavatorId ?? null },
    machine,
    machineOptions,
    machinesWorking: workingHere,
    summary: totals,
    machines,
    workType: {
      bucket: { hours: totals.bucketHours, rate: site.bucketRate === null ? null : dec(site.bucketRate).toNumber(), revenue: totals.bucketRevenue },
      breaker: { hours: totals.breakerHours, rate: site.breakerRate === null ? null : dec(site.breakerRate).toNumber(), revenue: totals.breakerRevenue },
      other: { hours: totals.otherHours, revenue: totals.otherRevenue },
      totalHours: totals.hours,
      totalRevenue: totals.revenue,
      billedRevenue: totals.billedRevenue,
      unbilledRevenue: totals.unbilledRevenue,
    },
    diesel: {
      total: totals.diesel,
      avgPerDay: totals.avgDieselPerDay,
      /** The exact rate: diesel actually BURNED per working hour, which needs
       * a closing tank reading. Null when none has been entered. */
      avgPerHour: consumptionPerHour(machines, closings, f),
      /** The plain-arithmetic rate, always available: diesel taken ÷ hours
       * worked. See simpleDieselAverage. */
      simple: simpleDieselAverage(totals.hours, totals.diesel),
      consumption: dieselConsumption,
    },
    rateHistory: rateHistory.map((h) => ({
      id: h.id,
      bucketRate: h.bucketRate === null ? null : dec(h.bucketRate).toNumber(),
      breakerRate: h.breakerRate === null ? null : dec(h.breakerRate).toNumber(),
      effectiveFrom: h.effectiveFrom.toISOString().slice(0, 10),
    })),
    // The customer's own totals across ALL their bills / sites (not summed from sites: no double counting).
    customerFinancials,
  };
}

// ---------------------------------------------------------------------------------------------
// Diesel consumption rate (per-machine, cross-site)
// ---------------------------------------------------------------------------------------------

/** Headline rate for the machine card: the most recent entry's own average
 * (same formula as the readings table — see dieselEntryAverage), plus how long
 * the diesel left in the tank should last at that rate. */
async function getDieselConsumptionStats(
  businessId: string,
  siteId: string,
  f: SiteAnalysisFilters & { excavatorId: string },
) {
  const latest = await listDailyReadings(businessId, siteId, { ...f, page: 1, pageSize: 1 });
  const row = latest?.rows[0];
  if (!row || row.closingDiesel == null) return null;
  return {
    date: row.date,
    avgLPerHour: row.average,
    consumed: row.dieselConsumed,
    currentTank: row.closingDiesel,
    predictedHours: row.average != null && row.average > 0 ? num(row.closingDiesel / row.average) : null,
    flagged: row.dieselFlagged,
  };
}

// ---------------------------------------------------------------------------------------------
// Daily readings + diesel entries (paginated)
// ---------------------------------------------------------------------------------------------

export type DailyReadingRow = {
  date: string;
  excavatorId: string;
  machineName: string;
  machineNumber: string | null;
  operatorName: string | null;
  startReading: number | null;
  endReading: number | null;
  /** Meter hours (end - start) when valid, else recorded hours. */
  totalHours: number;
  /** Recorded (billable) hours for the day. */
  recordedHours: number;
  bucketHours: number;
  brekarHours: number;
  otherHours: number;
  diesel: number;
  /** Litres left in the tank at the close of this entry. */
  closingDiesel: number | null;
  /** Closing balance of this machine's previous entry at this site. */
  prevClosingDiesel: number | null;
  /** (prevClosing + diesel) - closing, i.e. what this entry actually burned. */
  dieselConsumed: number | null;
  /** Diesel litres per working hour for THIS entry; null when not computable. */
  average: number | null;
  /** Consumption came out negative — the readings need checking. */
  dieselFlagged: boolean;
  /** totalHours - (bucket + brekar). */
  readingDifference: number;
  /** A stored end reading was lower than its start reading. */
  flagged: boolean;
};

/** Per-entry diesel average for Site Analysis. Uses only this entry and the
 * immediately previous closing balance of the same machine at the same site —
 * never a lifetime or cumulative average.
 *   available = (previous closing ?? 0) + litres filled on this entry
 *   consumed  = available - this entry's closing
 *   average   = consumed / this entry's running hours */
export function dieselEntryAverage(e: {
  hours: number;
  filled: number;
  closing: number | null;
  prevClosing: number | null;
}): { average: number | null; consumed: number | null; flagged: boolean } {
  // Without a closing balance (or anything to measure it against) an average
  // would be a guess, so show nothing rather than something misleading.
  if (e.closing == null || (e.prevClosing == null && e.filled <= 0)) {
    return { average: null, consumed: null, flagged: false };
  }
  const consumed = num((e.prevClosing ?? 0) + e.filled - e.closing);
  if (consumed < 0) return { average: null, consumed, flagged: true };
  if (e.hours <= 0) return { average: null, consumed, flagged: false };
  return { average: num(consumed / e.hours), consumed, flagged: false };
}

/**
 * The simple diesel average: what was taken, over the hours worked. No tank
 * readings involved, so it can always be shown.
 *
 * The exact rate below (`consumptionPerHour`) measures diesel actually burned,
 * which needs the litres left in the tank; until somebody enters those it
 * returns null and the screen had nothing to show at all. That is the wrong
 * answer to "what is this machine averaging": the owner has the two numbers
 * that matter — hours run and diesel put in — and dividing them is the figure
 * they have always worked with by hand.
 *
 * Both forms are returned because both get asked for:
 *   litresPerHour = diesel ÷ hours  (how the rate is normally quoted)
 *   hoursPerLitre = hours ÷ diesel  (how long a litre lasts)
 *
 * It is an approximation, deliberately: diesel filled on a day is not
 * necessarily diesel burned on that day, so over a short window a big fill
 * skews it. Over a month it settles. The UI labels it as the simple figure and
 * says what to enter to get the exact one.
 */
export function simpleDieselAverage(
  hours: number,
  diesel: number,
): { litresPerHour: number | null; hoursPerLitre: number | null } {
  return {
    litresPerHour: hours > 0 && diesel > 0 ? num(diesel / hours) : null,
    hoursPerLitre: hours > 0 && diesel > 0 ? num(hours / diesel) : null,
  };
}

/** Litres actually burned per working hour across the scope — NOT litres filled
 * per hour, which counts diesel still sitting in the tank.
 *
 * Summing the per-entry rule over a machine's entries telescopes neatly:
 *   (f1 - c1) + (c1 + f2 - c2) + ... = (total filled) - (latest closing)
 * so a machine contributes only once its closing balance is known; machines
 * without one are left out rather than silently inflating the rate. */
function consumptionPerHour(
  machines: { excavatorId: string; hours: number; diesel: number }[],
  closings: { day: string; excavatorId: string; closing: number }[],
  f: SiteAnalysisFilters,
): number | null {
  const latest = new Map<string, number>();
  for (const c of closings) {
    if (f.from && c.day < f.from) continue;
    if (f.to && c.day > f.to) continue;
    latest.set(c.excavatorId, Number(c.closing)); // oldest-first, so the last write wins
  }
  let consumed = 0;
  let hours = 0;
  for (const m of machines) {
    const closing = latest.get(m.excavatorId);
    if (closing == null) continue;
    consumed += m.diesel - closing;
    hours += m.hours;
  }
  return hours > 0 && consumed > 0 ? num(consumed / hours) : null;
}

/** Closing balance per machine per day at one site, oldest first. Deliberately
 * ignores the view's date filter: an entry's previous balance often predates it. */
async function closingBalances(businessId: string, siteId: string, excavatorId?: string) {
  const machineCond = excavatorId ? Prisma.sql`AND s."excavatorId" = ${excavatorId}` : Prisma.empty;
  return db.$queryRaw<{ day: string; excavatorId: string; closing: number }[]>(Prisma.sql`
    WITH c AS (
      SELECT l.date AS date, s."excavatorId" AS "excavatorId", l.id AS "entryId",
             l."createdAt" AS "enteredAt", l."remainingDieselLiters" AS closing
      FROM "DailyWorkLog" l
      JOIN "WorkSession" s ON s.id = l."workSessionId"
      WHERE s."businessId" = ${businessId} AND s."siteId" = ${siteId} AND l.status = 'APPROVED'
        AND l."remainingDieselLiters" IS NOT NULL ${machineCond}
      UNION ALL
      SELECT s."startDate", s."excavatorId", s.id, s."createdAt", s."remainingDieselLiters"
      FROM "WorkSession" s
      WHERE s."businessId" = ${businessId} AND s."siteId" = ${siteId}
        AND s."remainingDieselLiters" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "DailyWorkLog" dl WHERE dl."workSessionId" = s.id)
        ${machineCond}
    )
    SELECT to_char(date::date, 'YYYY-MM-DD') AS day, "excavatorId",
           (array_agg(closing ORDER BY "enteredAt" DESC, "entryId" DESC))[1]::float8 AS closing
    FROM c GROUP BY date::date, "excavatorId"
    ORDER BY date::date ASC`);
}

async function siteScope(businessId: string, siteId: string, f: SiteAnalysisFilters): Promise<Scope | null> {
  const site = await db.site.findFirst({ where: { id: siteId, businessId }, select: { id: true } });
  if (!site) return null;
  if (f.excavatorId) {
    const ex = await db.excavator.findFirst({ where: { id: f.excavatorId, businessId }, select: { id: true } });
    if (!ex) return null;
  }
  const { from, to } = parseRange(f.from, f.to);
  return { businessId, siteCond: Prisma.sql`st.id = ${siteId}`, excavatorId: f.excavatorId, from, to };
}

export async function listDailyReadings(
  businessId: string,
  siteId: string,
  f: SiteAnalysisFilters & { page?: number; pageSize?: number },
) {
  const scope = await siteScope(businessId, siteId, f);
  if (!scope) return null;
  const pageSize = f.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = f.page ?? 1;

  const [rows, closings] = await Promise.all([
    db.$queryRaw<AggRow[]>(Prisma.sql`
    ${entriesCte(scope)}
    SELECT to_char(date::date, 'YYYY-MM-DD') AS day, "excavatorId", min("excavatorName") AS "machineName",
           min("machineNumber") AS "machineNumber",
           (array_agg("operatorName" ORDER BY "entryId"))[1] AS "operatorName",
           (array_agg(closing ORDER BY "enteredAt" DESC, "entryId" DESC) FILTER (WHERE closing IS NOT NULL))[1]::float8 AS closing,
           min("startMeter") AS "startReading", max("endMeter") AS "endReading",
           sum(CASE WHEN "startMeter" IS NOT NULL AND "endMeter" IS NOT NULL AND "endMeter" >= "startMeter"
                    THEN round(("endMeter" - "startMeter")::numeric, 2) ELSE hours END)::float8 AS "totalHours",
           COALESCE(sum(hours), 0)::float8 AS "recordedHours",
           COALESCE(sum(hours) FILTER (WHERE wtype = 'BUCKET'), 0)::float8 AS "bucketHours",
           COALESCE(sum(hours) FILTER (WHERE wtype = 'BREAKER'), 0)::float8 AS "brekarHours",
           COALESCE(sum(hours) FILTER (WHERE wtype = 'OTHER'), 0)::float8 AS "otherHours",
           COALESCE(sum(diesel), 0)::float8 AS diesel,
           COALESCE(bool_or("startMeter" IS NOT NULL AND "endMeter" IS NOT NULL AND "endMeter" < "startMeter"), false) AS flagged,
           count(*) OVER ()::int AS total
    FROM val WHERE ${dateCond(scope)}
    GROUP BY date::date, "excavatorId"
    ORDER BY date::date DESC, min("excavatorName"), "excavatorId"
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    closingBalances(businessId, siteId, f.excavatorId),
  ]);

  // Previous closing balance = the latest earlier day for that same machine.
  const history = new Map<string, { day: string; closing: number }[]>();
  for (const c of closings) {
    const list = history.get(c.excavatorId) ?? [];
    list.push({ day: c.day, closing: Number(c.closing) });
    history.set(c.excavatorId, list);
  }
  const prevClosingFor = (excavatorId: string, day: string) => {
    const list = history.get(excavatorId);
    if (!list) return null;
    let prev: number | null = null;
    for (const c of list) {
      if (c.day >= day) break; // list is oldest-first, days are ISO so string order == date order
      prev = c.closing;
    }
    return prev;
  };

  const total = rows[0] ? Number(rows[0].total) : 0;
  const mapped: DailyReadingRow[] = rows.map((r) => {
    const totalHours = num(r.totalHours);
    const bucketHours = num(r.bucketHours);
    const brekarHours = num(r.brekarHours);
    const diesel = num(r.diesel);
    const day = r.day as string;
    const excavatorId = r.excavatorId as string;
    const closingDiesel = r.closing === null || r.closing === undefined ? null : num(r.closing);
    const prevClosingDiesel = prevClosingFor(excavatorId, day);
    const d = dieselEntryAverage({
      hours: totalHours,
      filled: diesel,
      closing: closingDiesel,
      prevClosing: prevClosingDiesel,
    });
    return {
      date: day,
      excavatorId,
      machineName: r.machineName as string,
      machineNumber: (r.machineNumber as string | null) ?? null,
      operatorName: (r.operatorName as string | null) ?? null,
      startReading: r.startReading === null ? null : Number(r.startReading),
      endReading: r.endReading === null ? null : Number(r.endReading),
      totalHours,
      recordedHours: num(r.recordedHours),
      bucketHours,
      brekarHours,
      otherHours: num(r.otherHours),
      diesel,
      closingDiesel,
      prevClosingDiesel,
      dieselConsumed: d.consumed,
      average: d.average,
      dieselFlagged: d.flagged,
      readingDifference: num(totalHours - bucketHours - brekarHours),
      flagged: Boolean(r.flagged),
    };
  });
  return { rows: mapped, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function listDieselEntries(
  businessId: string,
  siteId: string,
  f: SiteAnalysisFilters & { page?: number; pageSize?: number },
) {
  const scope = await siteScope(businessId, siteId, f);
  if (!scope) return null;
  const pageSize = f.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = f.page ?? 1;

  const [rows, totals] = await Promise.all([
    db.$queryRaw<AggRow[]>(Prisma.sql`
      ${entriesCte(scope)}
      SELECT "entryId" AS id, to_char(date::date, 'YYYY-MM-DD') AS day, "excavatorId", "excavatorName", "machineNumber",
             diesel::float8 AS litres, notes, count(*) OVER ()::int AS total
      FROM val WHERE ${dateCond(scope)} AND diesel > 0
      ORDER BY date DESC, "entryId"
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    aggregateAll(scope),
  ]);
  const total = rows[0] ? Number(rows[0].total) : 0;
  return {
    entries: rows.map((r) => ({
      id: r.id as string,
      date: r.day as string,
      excavatorId: r.excavatorId as string,
      machineName: r.excavatorName as string,
      machineNumber: (r.machineNumber as string | null) ?? null,
      litres: num(r.litres),
      notes: (r.notes as string | null) ?? null,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    totalLitres: totals.diesel,
    avgPerDay: totals.avgDieselPerDay,
    avgPerHour: totals.avgDieselPerHour,
  };
}

/** For routes: a missing site / machine is a 404 (also covers another tenant's ids). */
export function notFound(what: string): never {
  throw new ApiHttpError("NOT_FOUND", `${what} not found`);
}
