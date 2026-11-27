# 10 — Reports and Financial Reconciliation

This document covers every report the product shows: what business question it answers, which records it uses, its date basis, its formulas and whether it can be exported. It then explains how the figures reconcile with each other, and where they do not.

The formula IDs (FI-, RC-, FU-, SA-, R-PROFIT) are defined in 05_BUSINESS_RULES_AND_CALCULATIONS.md. Report-by-report detail, with evidence, is in deep dive 05 (§2, Report register R1–R23).

## 1. Four different money measures — never interchangeable

| Measure | Plain meaning | Where it appears | Includes GST? | Includes unbilled work? | Date basis |
|---|---|---|---|---|---|
| **Invoiced (billed revenue)** | Sum of bill totals | Dashboard "Revenue", Revenue chart, Top Customers, Payment Collection, Site-detail "Customer Total Revenue" | Yes (net of customer-supplied diesel) | No | Bill date |
| **Work value** | What approved work is worth: billed work at its bill-line share, unbilled work at the site rate on the work date | Site Analysis Revenue, Profit revenue (work part), Machine Performance | No | Yes | Work date |
| **Collected cash** | Sum of payments | Dashboard "Amount Received", Site "Received" (pro-rata), customer paid | — | — | Payment date |
| **Pending** | Not one measure: **three different definitions** | Customer pages (RC-2), Dashboard (RC-5), Site Analysis (RC-6), bill (BI-9) | Mixed | Customer and Dashboard: yes. Site: n/a. Bill: no | — |

**Profit** (R-PROFIT) is **work value + bill charges − discount − recorded costs**. It is **not** cash received minus cash spent, and **not** invoiced revenue minus expenses.

## 2. Report inventory

| ID | Report | Business question | Source records | Date basis | Filters | Export |
|---|---|---|---|---|---|---|
| RPT-01 | Site Analysis list (`/site-analysis`) | For each site: hours, value, received, pending; where are my machines? | Approved readings, jobs without readings, normal-bill lines, bills (paid fraction), sites, rates | Work date | Search, type, status, machine, date presets (All / Today / Week / Month / Last month / Custom) | No |
| RPT-02 | Site detail | Full picture of one site: work-type split, diesel use, machines, daily readings, customer account | As RPT-01 plus closing diesel; customer bills | Work date (customer account all-time) | Machine, dates | **PDF share** (no daily readings); no Excel |
| RPT-03 | Machine drill-down (site) | One machine at one site: work, diesel, can-run-for, revenue | As RPT-02 | Work date | Dates | No |
| RPT-04 | Machines by site ("Our machines by site") | Where is every machine now? | Machines, active jobs, current site | Now | — | No |
| RPT-05 | Dashboard cards | Customers; invoiced; received; all-time total & pending; hours worked | Customers, bills, payments, readings, work engine | Range (Total/Pending all-time) | Range presets incl. Financial Year | No |
| RPT-06 | Business Profit Overview + Detail | Did the business make money in the period? | R-PROFIT inputs | Mixed (see R-PROFIT) | Range | No |
| RPT-07 | Payment Collection Status | Which customers are paid / partly paid / unpaid? | Bills by customer | Bill date | Range | No |
| RPT-08 | Revenue – last 6 months | Invoicing trend | Bills | Bill date | **Ignores range** | No |
| RPT-09 | Working hours – last 6 months | Activity trend | Readings (any status), jobs without readings | Reading date | Ignores range | No |
| RPT-10 | Hours detail (Hours card "View detail") | Hours per machine and tool | Completed jobs starting or ending in range | Job start/end | Range | No |
| RPT-11 | Top Customers | Biggest customers | Bills | Bill date | Range | No |
| RPT-12 | Recent Activity | What happened lately | Jobs created/completed, bills, payments | Created/updated time | — | No |
| RPT-13 | Alerts bell / banner | What needs attention | Pending readings and jobs, active operator jobs, service due, component due | Now | — | No |
| RPT-14 | Machine Performance (Machines page) | Earnings and hours per machine by day/week/month/year | Work engine, Summary lines, Direct bill totals | Work date / bill date | Period | No |
| RPT-15 | Customer list totals | Total and pending per customer and overall | Bills, unbilled work | All-time | Search, trip date | No |
| RPT-16 | Customer detail | One customer's account, work history and unbilled work by site | Bills, jobs, readings, unbilled work | All-time (list filterable) | Machine, site, dates | No (WhatsApp reminder) |
| RPT-17 | Bills list | All invoices with status and pending | Bills | Bill date order | All / App-generated / Self-generated; text search | **Excel register** (Bill no., date, customer, type, sites, total, paid, pending, status, with totals; max 20,000 rows) |
| RPT-18 | Bill document | The invoice | Bill, lines, letterhead snapshot, live customer & machine | — | Template Standard / Daily Summary | Print, PDF/WhatsApp, **per-bill Excel** (Standard layout only) |
| RPT-19 | Operator detail tabs | Salary owed, money history, sessions, job history | Operator, periods, leave, transactions, jobs | Since joining / per month / per session | Month navigator | No |
| RPT-20 | Operators list | Due/overpaid per operator; 45-day ranking | As RPT-19 | — | — | No |
| RPT-21 | Machine Service tab / component page | Service due, history, replacements, per-component history | Service records | — | — | No |
| RPT-22 | Expenses page | Recent expenses and their total | Expenses (latest 200) | Expense date | **None in the screen** | No |
| RPT-23 | Diesel Checker | Calculator only | User input | — | — | No |
| — | *Built but not displayed:* Overdue Payments (bills unpaid more than 15 days), Operator Performance (this month) | — | — | — | — | — |

## 3. Reconciliation rules (how figures should tie out, and where they do not)

### 3.1 Bill ↔ payments (internally consistent)

- **Rule.** For every bill, `paid amount = Σ its payments`. Status follows BI-8, and `0 ≤ paid ≤ total`. This is guaranteed by the write logic, by database checks, and by the `npm run audit:integrity` checker (`docs/invariants.md`).
- **Reconciliation.** Σ "Paid" in the bills register equals Σ payments of the listed bills.
- **Not reconcilable.** A deleted bill's payments vanish from both sides; only the audit log keeps them.

### 3.2 Dashboard "Revenue" ↔ Bills register

- **Rule.** Both are sums of bill totals by bill date.
- **Limitation.** The register screen cannot be filtered by date (the export service supports it, but the screen never sends dates). Reconciliation therefore needs the Excel register filtered by hand.

### 3.3 Dashboard "Amount Received" ↔ payments

- **Rule.** Σ payments by **payment date** in the range.
- **Limitation.** No screen lists payments across bills. Payments are visible only per bill (and in Recent Activity).

### 3.4 Dashboard "Total Amount" / "Pending Amount" ↔ Bills register

- **Rule.** Dashboard Total = Σ all bill totals **+ all-time unbilled work value**, so it cannot equal the register total unless all work is billed.
- **Known overstatement.** Hours on Direct or Summary bills are in both parts (GAP-001).
- **To reconcile:** Dashboard Total − Σ register Total = unbilled work value (from the customer pages, "Work not billed yet").

### 3.5 Dashboard Pending ↔ Site Analysis Pending ↔ Customer Pending

They differ by design:

| Screen | Pending definition | Includes GST, charges, diesel advance? | Direct / Summary bills? |
|---|---|---|---|
| Dashboard | all bills + unbilled − all payments | Yes | Yes |
| Customer | (bills − paid) + unbilled | Yes | Yes |
| Site Analysis | work-line value − pro-rata receipts | No (only the line-amount share) | **No** |

The code comment claiming that Dashboard and Site Analysis agree holds only for the unbilled part.

### 3.6 Hours: Dashboard ↔ Site Analysis ↔ job totals ↔ bills

| Screen | What it counts |
|---|---|
| Dashboard Hours | **all** readings, including pending and rejected |
| Hours detail | completed jobs only |
| Site Analysis | approved readings only (and jobs with no readings) |
| Bills | job total at the time of billing |

Approvals, rejections and edits after billing make these drift.

### 3.7 Profit ↔ other figures

- **Profit revenue ≠ Dashboard Revenue.** Profit revenue excludes GST, includes unbilled work and is dated by work date.
- **Profit salary ≠ operator "remaining" or salary paid.** Profit uses the full-month base + bonus; the operator screens use daily accrual; cash paid is ignored.
- **Profit maintenance may double count** service records and expenses (GAP-006).
- **Profit diesel**, per machine, is expenses **or** litres × price, never both.

### 3.8 Machine Performance ↔ Profit

Machine Performance adds Direct-bill **total** (incl. GST, net of diesel advance); Profit adds the Direct-bill **subtotal**. The figures differ for every Direct bill with GST, transport or diesel.

### 3.9 Data-integrity checker (back-office)

`npm run audit:integrity` (see `docs/invariants.md`) re-checks:
- bill/payment/line arithmetic and GST maths;
- one active job per machine;
- tenant links between records.

It does **not** check:
- direct/summary versus work double counting;
- salary consistency;
- site versus dashboard totals.

## 4. Recommended reconciliation routine with the current product (no code change)

1. **Monthly invoicing.** Export the Bills register (Excel) and filter by bill date for the month. Its total = Dashboard "Revenue" for that month.
2. **Monthly collection.** Dashboard "Amount Received" for the month. There is no payment list to tick against bank statements; open each bill.
3. **Unbilled work.** For each customer, check "Work not billed yet — site wise" on the customer page. **Before relying on it, confirm none of those hours were already invoiced on a Direct or Summary bill** (GAP-001).
4. **Expenses.** Do not record a service's cost both as service-record line costs and as a SERVICE / REPAIR / PARTS / TYRES expense.
5. **Salary.** Use the operator **Overview** ("Since joining") or **Sessions** figure as the amount owed. The Salary tab month view uses a different rule (GAP-005).
