# 05 — Business Rules and Calculations Register

This is the single place where every calculation and business rule the application performs is written down.

## How to read this register

- **Source:** each formula is traced from code; see 11_EVIDENCE_REGISTER.md for the evidence index.
- **Evidence grade:** shown in the "Ev." column.
  - **B** = traced end to end
  - **C** = partly traced
  - **D** = inferred
- **Not runtime-verified:** nothing here was observed in a running application (no evidence grade A).
- **Paths:** relative to `excavator-manager/`.

## General conventions

| Topic | Rule | Ev. |
|---|---|---|
| Currency | Indian Rupee (₹). No multi-currency. | B |
| Money precision | Stored as exact decimals with 2 places (NUMERIC(14,2)). Rounding is **ROUND_HALF_UP to the paisa** (`src/lib/money.ts round2`). | B |
| Hours precision | Decimal hours, 2 places (e.g. 7.25 h = 7 h 15 min). There is no hh:mm storage. Rounding mixes Decimal HALF_UP (`roundHours`) and float `Math.round(x*100)/100` (`src/lib/utils/hours.ts`). Edge values such as x.005 may round differently. | B / D |
| Litres | Decimal, 2 places. | B |
| Live vs stored | **Almost everything is calculated live** from current records: salary, profit, site totals, customer pending, service due. Only bills store their own amounts (with their letterhead snapshot), plus `Bill.paidAmount`, which is kept equal to the sum of payments. Editing any underlying record changes every report for past periods immediately. There is no period close. | B |

---

## 1. Operational calculations (hours, meters, utilisation)

| ID | Calculation | Inputs | Exact formula | Result | When applied | Ev. |
|---|---|---|---|---|---|---|
| OP-1 | Hours from meter | Reading start meter, end meter | `hours = round2(end − start)`. Must be > 0 ("Working hours must be greater than 0"). Within a reading, end must be > start. | Decimal hours | Every daily reading in meter mode; Stop Work when there are no readings; operator-job approval | B |
| OP-2 | Hours from clock | Start time, stop time (HH:MM), break minutes | `stop' = stop < start ? stop + 24h : stop`; `hours = round2((stop' − start − break) / 60)`. Must be > 0. | Decimal hours | Daily reading in clock mode. If both meters and clock values are given, **the meter wins**. | B |
| OP-3 | Job total hours (owner-started job) | Approved WORK readings, start and end meter | If the job has ≥ 1 approved WORK reading: `Σ hoursWorked of approved WORK readings`. Otherwise: `round2(endMeter − startMeter)` at stop. | `WorkSession.totalHours` | Re-computed on every reading add, edit, delete and approval, and at stop | B |
| OP-4 | Job total hours (operator-started job) | Owner-corrected start and end meter | `round2(end − start)` | `WorkSession.totalHours` | On approval of the operator's job | B |
| OP-5 | Job total hours (owner edits job) | as OP-3 plus a typed total | approved readings → Σ; else typed totalHours; else meter difference; else unchanged. **A typed total is silently ignored when approved readings exist.** | `WorkSession.totalHours` | Edit job | B |
| OP-6 | Machine hour meter (`currentHourMeter`) | Events | Start Work, or operator Start: **set** to the typed start meter (can go backwards). Stop Work, or operator-job approval: **set** to the end meter (unconditional). Reading on an active job: **set** to the latest approved reading's meter. Reading approved on a completed job: **raised** only. Service record: `max(current, meterAtService)`. Deleting the last reading: rewound to the job's start meter. New machine: = starting hour meter. | Live meter | Every event above. **No continuity rule**: the opening meter is never checked against the previous closing. | B |
| OP-7 | Default opening for the next operator reading | Latest non-rejected reading's end meter, else the machine meter | A suggestion only; not enforced | Pre-filled value | Operator Submit Reading | B |
| OP-8 | Working days (customer page) | Readings that are not REJECTED; jobs without readings | Distinct dates of non-rejected readings with hours > 0 (or null); for a job without readings, every day from start to end (or to today while active). **Includes PENDING readings.** | Count | Customer detail | B |
| OP-9 | Idle days | Last completed job's end date | `floor((now − lastCompleted.endDate ?? machine.createdAt) / 1 day)`. Alert when the machine is IDLE and idleDays ≥ 7. | Days | Machine detail page only | B |
| OP-10 | Machine availability / status | — | Only IDLE and WORKING are ever written. WORKING is set by Start Work (owner or operator). IDLE is set by Stop Work, operator-job approval, or deleting an active job. **"SERVICE" (Under Service) is never set.** No availability check stops assignment or work on a machine that is archived or being serviced. | Status | — | B |
| OP-11 | Utilisation, downtime, standby, overtime, billable vs actual | — | **Not implemented.** No formula or field exists. | — | — | B |
| OP-12 | Operator ranking (Operators list) | Approved readings, plus jobs without readings, last 45 days | Σ hours per operator over 45 days | Rank | Operators list | B |

## 2. Fuel (diesel) calculations

The only diesel data the system holds:

- litres filled, entered on a reading, a diesel-only entry, a stop, or an operator job;
- litres left in the tank, as a closing balance;
- the diesel fill date.

**There is no diesel purchase, stock, supplier or issue ledger.**

| ID | Calculation | Exact formula | Where shown | Ev. |
|---|---|---|---|---|
| FU-1 | Job diesel total | `WorkSession.dieselLiters` = running sum (+=) of litres from owner readings, approved operator readings, approved diesel-only entries, and stop-work litres. Edits apply the difference; deletes subtract, never below 0. **An owner job edit overwrites the total with the typed value** (a blank field clears it). | Job, bills (normal bill diesel default) | B |
| FU-2 | Per-entry consumption (Site Analysis daily readings) | `consumed = (previous closing balance, same machine and same site, ?? 0) + litres filled − this closing`. `average L/hr = consumed ÷ hours`. Null if there is no closing, or if there is no previous closing and nothing was filled. Negative → row flagged. | Daily Machine Reading table | B |
| FU-3 | Simple diesel average | `L/hr = Σ diesel ÷ Σ hours`; `hr/L = Σ hours ÷ Σ diesel` | Site detail, machine drill-down | B |
| FU-4 | "Exact" average (diesel burned) | `Σ over machines (Σ filled − latest closing) ÷ Σ hours`. **Assumes the tank was empty at the start of the window.** | Site detail | B |
| FU-5 | Can-run-for hours | `closing litres ÷ latest average` | Machine drill-down | B |
| FU-6 | Diesel Checker (calculator) | `consumed = remaining given ? max(0, taken − remaining) : taken`; `avg = round2(consumed ÷ hours)`; `hoursLeft = round2(remaining ÷ avg)`. **Nothing is saved.** | `/diesel-checker` | B |
| FU-7 | Diesel cost (profit only) | Per machine, per period: if the machine has **any** DIESEL-type expense in the period, the cost is Σ those expense amounts. Otherwise `litres × Business.dieselPricePerLitre` when a price is set. Otherwise uncosted (shown as "uncosted litres"). **All-or-nothing per machine:** one small DIESEL expense replaces all litre-based costing for that machine in that period. | Profit Overview | B |
| FU-8 | Customer-supplied diesel on a bill | `dieselAdvance = deductDiesel ? round2(round2(litres) × round2(price per litre)) : 0`, subtracted from the bill **after** GST. Normal bill litres = Σ of the selected jobs' litres (computed in the browser; the server trusts the value). The per-bill price is typed each time and does **not** default from the Settings diesel price. | Bills | B |
| FU-9 | Owner-supplied vs customer-supplied fuel | **No field distinguishes them.** The only expression of customer-supplied diesel is the bill's diesel-advance deduction. Profit Overview costs all recorded litres alike (deliberate; see the `getProfitOverview` doc comment). | — | B |

## 3. Operator salary calculations

Salary depends **only on calendar time** in a working period. Hours, attendance and daily logs never affect it.

| ID | Calculation | Exact formula | Where used | Ev. |
|---|---|---|---|---|
| SA-1 | Transaction classification | `businessEffect = SALARY_PAYMENT` → **paid**. `BONUS_INCENTIVE` → **bonus**. Any other effect (ADVANCE_RECOVERABLE, BUSINESS_EXPENSE, OTHER) with "deduct from salary" ticked → **deduction**. Unticked → **ignored by salary**. (`salaryCore.ts isDeduction / applyTransaction`) | All salary views | B |
| SA-2 | Daily accrual ("anniversary cycles") | Cycles run from the joining or period start date to the same date next month, clamped to the month end. `accrued = monthly × fullCycles + monthly × elapsedDays ÷ daysInCurrentCycle (28–31)`. The as-of day itself is excluded, so today is not yet earned. A closed period accrues through its end date inclusive. `salaryBasisDays` (always 30) is **not used**; it only drives a displayed "daily rate". | Overview tab, Operators list (B), Sessions (C) | B |
| SA-3 | Operator with one active period and no leave: lifetime | `Total payable = accrual(joining → now, defaultMonthlySalary) + Σbonus − Σdeductions`; `Remaining = Total payable − Σpaid` (positive = owed to the operator, negative = overpaid). Transactions counted: joining day ≤ date < tomorrow. | Overview "Since joining", Operators list "Due / Overpaid" | B |
| SA-4 | Period-based (sessions, leave): per period | `earned = accrual(start → end+1 or now, period.monthlySalary) + paid-leave pay − unpaid-leave deduction`; `pending = earned + bonus − deductions + openingBalance − paid`. Unpaid-leave deduction = accrual over the leave days at that period's rate (cycle length measured from the leave start). Paid leave in a gap = accrual at the **previous** period's rate. | Sessions tab, Overview for multi-period operators, Dashboard due | B |
| SA-5 | Carry forward | Starting a new period when the old period's pending > 0 requires **Carry Forward** (opening balance = pending; the old period then counts 0) or **Keep Separate**. **A negative pending (operator owes money) is never carried.** It stays on the old period but still counts in the operator total. | Start New Session | B |
| SA-6 | Calendar-month salary (Salary tab) | `base(month)`: for a one-period, no-leave operator it is the **full monthly salary for every month from the joining month on, including the joining month and the current month in full**. Otherwise, the salary of the latest period touching the month (full month for even one day), or the previous period's rate for a month touched by paid leave, else 0. `payable(month) = base + bonus − deductions − paid + carriedForward`, where `carriedForward = Σ over earlier months of (base + bonus − deductions − paid)`. Unpaid leave inside a period and carry-forward balances are **ignored**. (`salary.ts computeSalaryForMonth` L97-148, verified by the main investigator) | Salary tab month view, Profit salary cost | B |
| SA-7 | Dashboard "Operator Salary Due" | `Σ over non-archived operators of max(0, round2(complex ? outstanding(SA-4) : payable(SA-6, current month)))`. Overpaid operators do not offset. (`salary.ts getTotalSalaryDue` L423-435, verified) | Dashboard | B |
| SA-8 | Overtime, hourly or daily wages, attendance-based pay | **Not implemented.** | — | B |
| SA-9 | **Divergence warning** | SA-3 / SA-4 (daily accrual) and SA-6 (full-month base) give **different "remaining" figures for the same operator**. Worked example (deep dive 03, C7): joined 7 Jul, ₹30,000/month, viewed 24 Nov. The Overview shows ₹33,000 remaining; the Salary tab shows ₹46,000 payable. | — | B |

**Worked example (SA-3):**
- Joining 07-Jul-2026, salary ₹30,000, as of 24-Nov-2026.
- Four full cycles = ₹1,20,000. The running cycle is 17 of 30 days = ₹17,000. Accrued = **₹1,37,000**.
- Transactions: advance ₹5,000 (deducted), bonus ₹1,000, salary paid ₹1,00,000.
- Total payable = 1,37,000 + 1,000 − 5,000 = **₹1,33,000**. Remaining = **₹33,000**.

## 4. Billing calculations

| ID | Calculation | Exact formula | Applies to | Ev. |
|---|---|---|---|---|
| BI-1 | Line amount | `round2(round2(hours) × round2(rate))` | All bill lines | B |
| BI-2 | Normal-bill line hours | `round2(WorkSession.totalHours)` at billing time. **One rate for all selected lines**, defaulting to the site's *current* Bucket or Breaker rate (not the rate in force on the work date). | Normal bill | B |
| BI-3 | Subtotal | Normal and summary bills: `Σ line amounts`. Direct bill: `round2(bucketHours × bucketRate) + round2(breakerHours × breakerRate)`. | — | B |
| BI-4 | Taxable value | Normal and summary bills: `subtotal + transport + fuel + extra + bucketCharge + breakerCharge − discount`. Direct bill: `subtotal + transport` (no fuel, extra or discount). Direct bill requires taxable > 0. | — | B |
| BI-5 | GST | Only when bill type = GST. `tax = round2(taxable × rate ÷ 100)`; `CGST = round2(tax ÷ 2)`; `SGST = tax − CGST`. **IGST is always empty** (no inter-state option). Rate 0–28 is allowed; the screen offers 5 / 12 / 18 / 28 %. | GST bills | B |
| BI-6 | Diesel advance | FU-8 | Optional | B |
| BI-7 | Final bill total | `total = round2(taxable + tax − dieselAdvance)`. Must be between 0 and 999,999,999,999.99 ("The bill total can't be negative…"). | All bills | B |
| BI-8 | Bill status | `paid ≤ 0` → UNPAID; `0 < paid < total` → PARTIAL; `paid ≥ total` → PAID (only = total is possible). Re-derived on every payment and every bill edit. | All bills | B |
| BI-9 | Bill pending | `totalAmount − paidAmount` | Bill detail, list, register | B |
| BI-10 | Bill number | Non-GST, automatic: `"NG-" + 4-digit zero-padded counter` (NG-0001…), taken atomically per business, skipping numbers already used by hand. Non-GST, manual: the typed text. GST: **always typed by hand** (required); there is no GST sequence. All bill numbers of a business share one uniqueness space. Deleted numbers are never reused. | All bills | B |
| BI-11 | Amount in words | Rupees and paise, Indian numbering ("… Rupees and NN Paise Only") | Bill print and Excel | B |
| BI-12 | Daily Summary template rows | Rebuilt **live** from the approved readings of the billed jobs, but only when they add up to the billed hours (otherwise one row per line). `day amount = round2(hours × line rate)`; the last day absorbs the rounding difference. | DAILY_SUMMARY template | B |
| BI-13 | Minimum hours, extra hours, shift, daily or monthly hire | **Not implemented.** Billing is hourly only. | — | B |
| BI-14 | TDS, credit notes, place of supply, HSN/SAC | **Not implemented.** | — | B |

**Worked example (normal bill):**
- Two jobs, 8.5 h + 10.25 h, at ₹1,200/h. Lines ₹10,200 + ₹12,300 = subtotal **₹22,500**.
- Transport ₹2,000, extra ₹500, discount ₹1,000. Taxable = **₹24,000**.
- GST 18 %: tax ₹4,320 (CGST ₹2,160 + SGST ₹2,160).
- Customer supplied 50 L at ₹92.50: diesel advance ₹4,625.
- **Total = 24,000 + 4,320 − 4,625 = ₹23,695.**

**Worked example (direct bill):**
- Bucket 20 h × ₹1,100 = ₹22,000; Breaker 5.5 h × ₹1,800 = ₹9,900. Subtotal ₹31,900.
- Transport ₹1,500, so taxable ₹33,400. Non-GST.
- Diesel 100 L × ₹90 = ₹9,000. **Total = ₹24,400.**

## 5. Receivables and payment rules

| ID | Rule | Exact behaviour | Ev. |
|---|---|---|---|
| PA-1 | Payment amount | 0.01 ≤ amount ≤ the bill's remaining balance (`total − Σ other payments`). Over the balance: "Amount exceeds the pending balance of ₹X". This is also enforced by a database check. | B |
| PA-2 | Payment belongs to one bill | Every payment needs a bill. **No advance, unallocated, on-account or multi-bill receipt is possible.** | B |
| PA-3 | Payment edit / delete | Allowed at any time. The bill's paid amount and status are recalculated in the same step. Audited. | B |
| PA-4 | Bill edit vs payments | A bill can be edited after payment; the new total must be ≥ the amount paid ("…lower than the ₹Y already paid. Change or remove a payment first."). | B |
| PA-5 | Bill delete | Deletes the bill **and all its payments** permanently. The audit log keeps a snapshot. Linked work becomes billable again. | B |
| RC-1 | **Customer Total (customer pages)** | `Σ bill totals (incl. GST, net of diesel advance) + value of unbilled approved work (hours × site rate on the work date; Bucket and Breaker only; no GST)` | B |
| RC-2 | **Customer Pending (customer pages, WhatsApp reminder)** | `(Σ bill totals − Σ paid) + value of unbilled approved work`. This includes work never invoiced. | B |
| RC-3 | **Customer account on the Site Analysis detail page** | `Σ bill totals`, `Σ paid`, and the difference: **bills only**, across all of the customer's sites. | B |
| RC-4 | Dashboard "Total Amount" (all-time) | `Σ all bill totals + all-time unbilled work value` | B |
| RC-5 | Dashboard "Pending Amount" (all-time) | `Total Amount (RC-4) − Σ all payments` | B |
| RC-6 | Site "Received" and "Pending" | Per work entry: `received = billed line amount share × (bill paid ÷ bill total)`; `pending = revenue − received`. Bill-level charges, GST, Direct bills and Summary bill lines are **not** in site figures. | B |
| RC-7 | **Double-counting rule (defect)** | A job is "billed" only when a normal-bill line links to it. Hours invoiced on a **Direct** or **Summary** bill stay "unbilled", so they are counted again in RC-1, RC-2, RC-4, RC-5, the site figures and the profit revenue. They also remain available for another bill. | B (verified by the main investigator) |

## 6. Financial performance calculations (Dashboard)

| ID | Figure | Exact formula | Date basis | Ev. |
|---|---|---|---|---|
| FI-1 | **Revenue card** | `Σ Bill.totalAmount` with bill date in range (includes GST, net of diesel advance; excludes unbilled work) | Bill date | B |
| FI-2 | **Amount Received** | `Σ Payment.amount` with payment date in range | Payment date | B |
| FI-3 | Total Amount, Pending Amount | RC-4, RC-5 (all-time; ignore the range) | — | B |
| FI-4 | Hours Worked card | `Σ hours of daily readings in range, **any status (pending and rejected included)**` + `Σ totalHours of jobs without readings that start or end in range` | Reading date | B |
| FI-5 | Revenue — last 6 months chart | `Σ Bill.totalAmount per month` (ignores the range) | Bill date | B |
| FI-6 | Working hours — last 6 months chart | readings of any status, plus jobs without readings spread evenly over their days | Reading date | B |
| FI-7 | Payment Collection Status | Per customer, for bills dated in range: Paid if pending ≤ 0.01; Partial if paid > 0.01; otherwise labelled **"Overdue"**, which only means *nothing paid*. There is no due date or age rule. | Bill date | B |
| FI-8 | Top Customers | Top 5 by `Σ bill totals` in range, with received and pending | Bill date | B |
| R-PROFIT | **Business Profit Overview** | See below | mixed | B |

**R-PROFIT — "Business Profit Overview"** (`dashboard.ts getProfitOverview`, verified by the main investigator)

```
REVENUE (excludes GST)
  = value of work done in the period
      (billed work at its share of the bill line; unbilled work at the site rate on the work date;
       Chaining/other work and work at sites with no rate = ₹0, reported as "unpriced hours")   [work date]
  + Summary-bill lines (bill lines not linked to work) + Direct-bill SUBTOTALS                   [bill date]
  + Σ (transport + fuel + extra + bucket charge + breaker charge) − Σ discount on all bills       [bill date]
  (customer-supplied diesel is NOT deducted from revenue)

EXPENSES
  = Operator salary  : Σ over non-archived operators of (calendar-month base SA-6 + bonus),
                        prorated by days of each month inside the range, never past today
                        (no range passed → the whole current month)
  + Maintenance      : Σ service-record cost (service date) + Σ expenses of type REPAIR, SERVICE, PARTS, TYRES
  + Diesel           : FU-7, per machine
  + Other            : Σ expenses of type TRANSPORT, OTHER

ACTUAL PROFIT = REVENUE − EXPENSES
MARGIN %      = PROFIT ÷ REVENUE (1 decimal; 0 when revenue ≤ 0)
```

**What this profit is:** **value of recorded work and charges, minus recorded costs**, on an accrual basis.

**What it is not:**
- **Not cash.** Payments received and salary actually paid are not used.
- **Not "billed revenue"**: unbilled work is included and GST is excluded.

**Left out:**
- operator advances, deductions, payments and "business expense" operator transactions;
- machine purchase cost, EMI or depreciation;
- GST payable.

**Known distortions:**
- Hours on a Direct or Summary bill are counted twice (RC-7).
- A service record and a matching REPAIR / SERVICE / PARTS / TYRES expense are counted twice.
- Archived operators drop out of past months' salary cost.
- Archived machines' costs remain.

| ID | Figure | Formula | Ev. |
|---|---|---|---|
| FI-9 | Machine Performance (per-machine "earnings") | Per machine and period: `work value (as in R-PROFIT) + Summary-bill lines + Direct-bill **totalAmount** (incl. GST, net of diesel advance)`. **Inconsistent with R-PROFIT, which uses the Direct-bill subtotal.** No costs per machine. | B (verified) |
| FI-10 | Machine-wise profit, site-wise profit, customer-wise profit | **Not implemented.** Costs carry no site, and salary is not allocated per machine. | B |

## 7. Maintenance calculations

| ID | Calculation | Exact formula | Ev. |
|---|---|---|---|
| MA-1 | Next service due (machine) | `interval = machine.serviceIntervalHrs ?? business default (350)`; `last = latest service record's meter ?? machine starting meter`; `nextDue = latest record's nextServiceDueHour ?? last + interval`; `dueIn = round2(nextDue − currentHourMeter)`; overdue if dueIn < 0; due soon if 0 ≤ dueIn ≤ alert threshold (default 50). | B |
| MA-2 | `nextServiceDueHour` of a record | `min over ticked components that have an interval of round2(meterAtService + interval)`. **A 50-hour item (Greasing, Bucket Teeth) ticked on a full service sets the machine's next service at +50 h**, overriding the machine interval. | B |
| MA-3 | Component alert | `due = last done meter for that component (or the current meter if never serviced) + component interval`; alert when ≤ 15 h remain, danger when overdue; top 8. A never-serviced component can never alert. | B |
| MA-4 | Service record cost | `Σ round2(item cost)` | B |
| MA-5 | Downtime, breakdown duration | **Not implemented.** | B |

## 8. Business rules (non-calculation)

| ID | Rule | Ev. |
|---|---|---|
| BR-1 | One machine has at most one active job, and at most one assigned operator. One operator is assigned to at most one machine (assigning ends their other assignment). | B |
| BR-2 | Starting work requires an assigned operator, and a customer that is not archived. The site is chosen by name and auto-created if new. It is blocked while an operator job on the machine is in progress or pending. | B |
| BR-3 | One live (approved or pending) reading per job per calendar day. Readings can only be added to an **active** job. | B |
| BR-4 | Operator-entered readings and jobs affect nothing (hours, meter, reports, billing) until approved. **Exception:** an operator Start Work immediately sets the machine to WORKING and its meter to the start reading. | B |
| BR-5 | Only **completed**, not-yet-linked jobs can go on a normal bill. A job is either billed whole or not at all. | B |
| BR-6 | A billed job cannot be deleted. It **can** be edited, and its readings can be edited, deleted or approved, without changing the bill. | B |
| BR-7 | Archived customers, bank accounts, operators and machines are hidden from pickers. Customers and bank accounts are refused for new records. Machines and operators are **not** refused by the server. Nothing archived can be restored. | B |
| BR-8 | Site status (Ongoing / Partially Completed / Completed / Deactive) is a label. It never blocks work or billing, and changes only by hand (including when moving a machine off a site). | B |
| BR-9 | Site rates are effective-dated. The rate for a day is the latest rate dated on or before that day. Work before the first rate uses the first rate. Rates cannot start in the future. History rows cannot be corrected, only superseded. | B |
| BR-10 | Customer, machine and bill-template details are **not** frozen on bills; they show current values. Business details, logos, signature and bank details **are** frozen at creation, and re-frozen from current Settings whenever the bill is edited. | B |
| BR-11 | Limits set by support: maximum operators, and maximum bills per day (counted from server midnight). | B |
| BR-12 | Every financial change (bill, payment, expense, operator money, rate, job, reading) writes an append-only audit entry. The owner cannot view the audit log in the app. | B |
