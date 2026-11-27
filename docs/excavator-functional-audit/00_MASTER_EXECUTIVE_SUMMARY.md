# TrackMarg Excavator Management — Executive Summary of the Functional Audit

*Audit date: 24 November 2026.*

*Product audited:* `excavator-manager`, the current version of TrackMarg's excavator management app (web and Android, plus an operator portal).

*How the audit was done:*
- Read-only. Nothing in the product was changed, and no records were created.
- Every conclusion comes from reading the product's own logic. The app was **not** run, so no behaviour was observed live.

---

## 1. What the system does, in one paragraph

TrackMarg is a business-management app for someone who owns excavators and rents them out by the hour, with an operator.

- **Registers.** The owner keeps a register of **machines**, **operators**, **customers** and **sites**.
- **Work recording.**
  - Each stretch of work becomes a **job** on a machine, for a customer, at a site.
  - Each day's work is a **reading**: meter or clock hours, the tool used, and diesel filled and left in the tank.
  - Operators can enter their own readings on their phones. These wait for the owner's approval.
- **Billing.** The owner turns completed work into **bills**, with optional GST, transport and other charges, and a deduction for diesel the customer supplied.
- **Payments and maintenance.** The owner records **payments** against bills, **services** done on each machine (with due-date alerts), and **expenses**.
- **Operator pay.** The owner manages operator **salary, advances and payments**.
- **Reporting.** A **dashboard** and a **Site Analysis** section show what was invoiced, collected and still owed, how many hours each machine and site worked, diesel consumption, and an estimate of profit.

## 2. Functional scope at a glance

| Area | What you can do | Maturity |
|---|---|---|
| **Machines** | Add, edit, retire (archive), reorder. Assign one operator. Record the current site. See the hour meter, work history, service history and earnings | Solid. Gaps: no "breakdown / under repair" state, no owned-vs-rented flag, no profit per machine |
| **Daily work and hour meter** | Start and stop jobs. Record daily readings by meter or clock. The app calculates hours. One reading per job per day | Solid core. Gaps: meter readings are not checked for continuity, billed work can still be edited, only hourly work (no shift, day or month hire) |
| **Operator portal and approvals** | Operators log in with mobile and PIN. They submit readings and diesel, or start and end their own jobs. The owner approves or rejects | Good. Gaps: the owner cannot cancel an operator's stuck job, and approving an older job can reset the machine's meter |
| **Diesel** | Litres filled and left in the tank, on work records. Average consumption per hour in reports. A calculator | Basic. **No diesel purchase, stock or supplier records** |
| **Maintenance** | Component-by-component service records with costs. Automatic "service due / overdue" alerts | Good. Gaps: services cannot be corrected or deleted, and the machine is never marked unavailable |
| **Expenses** | Record diesel bought, repairs, parts, tyres, transport and other costs per machine | Basic. No edit, no site link, no duplicate warning |
| **Customers and sites** | Customer records. Sites with hourly Bucket and Breaker rates that can change from a date | Good. Site "Completed" is a label only; it does not stop anything |
| **Operators and salary** | Monthly salary that builds up day by day. Leave. Breaks and re-joining as "sessions". Advances, bonuses, payments | Rich, but **the screens disagree on how much is owed** (see §5) |
| **Billing** | Three bill types: from completed jobs, a typed summary bill, a direct machine bill. GST, charges, diesel deduction, automatic numbering for non-GST bills, letterhead, print, PDF / WhatsApp, Excel | Feature-rich. **Important control gaps** (see §5) |
| **Payments and dues** | Part-payments against a bill. Status Unpaid / Partial / Paid. Outstanding per bill, customer and business | Works. No advances, no single receipt across several bills, no cancellation |
| **Reports** | Dashboard (invoiced, collected, total, pending, hours, profit, trends, top customers). Site Analysis (per site, machine, day, diesel). Shareable site PDF. Bills register Excel | Broad. **Figures do not always agree between screens** |
| **Settings and access** | Business profile, letterhead, bank accounts, diesel price, service intervals, operator language, joining code, app lock, password | Complete for one owner. **Only one login per business** (no staff roles) |

The full inventory is **131 individual actions** (02_MASTER_FEATURE_REGISTER.md) across **15 modules** (01_COMPLETE_MODULE_MAP.md).

## 3. Main operational workflow

**Machine → operator → job → readings → stop**

1. **Add a machine** with its starting hour meter. **Assign an operator** to it.
2. **Start Work.** Choose the customer and site and enter the opening meter.
   - The machine shows "Working".
   - Alternatively, the operator starts the job from their phone; the owner later approves it and picks the customer.
3. **Record each day** with a reading.
   - The app works out the hours: closing meter minus opening meter, or stop time minus start time minus break.
   - Readings an operator enters wait for approval.
4. **Stop Work** with the closing meter. The job becomes "Completed" and the machine "Idle".
5. **Record services** as they happen. The app warns when the next service is due (every 350 hours by default).

## 4. Main financial workflow

**Completed work → bill → payment → dues → profit**

1. **Generate a bill** for a customer. Tick the completed jobs to include and enter the hourly rate (pre-filled from the site). Add charges, GST and any diesel the customer supplied.
   - Non-GST bills are numbered automatically (NG-0001…). GST bill numbers are typed by hand.
2. **Send the bill:** print it, share the PDF on WhatsApp, or download it as Excel.
3. **Record payments** ("Give Money") as they arrive, in parts if needed. The bill moves Unpaid → Partial → Paid.
4. **Dues:** see what each customer owes, and what the whole business is owed, on the dashboard.
5. **Profit:** the dashboard estimates profit as **the value of work done (excluding GST), plus bill charges, minus recorded costs**. The costs are operator salary, maintenance, diesel and other expenses.
   - This is **not** cash in minus cash out.
   - It is **not** the same as the "Revenue" card, which shows what was invoiced, including GST.

## 5. The most important findings

**Money figures that can be wrong (Critical):**

1. **Direct and Summary bills can lead to double invoicing.**
   - Only the normal "Generate Bill" marks jobs as billed.
   - Hours invoiced on a Direct or Summary bill still show as "not billed yet". They can be billed again.
   - Every "Total" and "Pending" figure counts those hours twice. (GAP-001)
2. **Bills are never locked.**
   - Any bill, even a fully paid GST invoice, can be changed in every detail, or deleted.
   - Deleting a bill also deletes its payments. There is no cancellation or credit note. (GAP-002)
3. **"Pending" includes work that was never invoiced.**
   - Customer pending, the WhatsApp reminder and the dashboard pending add un-invoiced work (valued at site rates, without GST) to real invoice balances.
   - A reminder can ask a customer for money they were never billed. (GAP-003)
4. **Billed work can still be edited.**
   - Hours and readings on a billed job can be changed, and late readings approved. The bill does not change.
   - Hours approved after billing can never be billed. (GAP-004)
5. **The operator screens disagree on how much salary is owed.**
   - The Overview tab and the Salary tab use different rules.
   - Example: an operator who joined on 7 July at ₹30,000 a month shows ₹33,000 owed on one screen and ₹46,000 on the other, on the same day. The dashboard profit uses the second rule. (GAP-005)
6. **Maintenance cost can be counted twice in profit.** This happens if the same service is entered both on the Service tab with costs and as a Service / Repair / Parts expense. (GAP-006)

**Operational gaps (High):**

7. There is **no breakdown or "under repair" state**. The "Under Service" count on the dashboard is always zero.
8. **Hour-meter readings are not checked for continuity.** A typing mistake can wind the machine's meter backwards.
9. The owner **cannot cancel an operator's unfinished job**, which blocks owner-entered work on that machine.
10. There is **no diesel purchase, stock or supplier record**, so fuel bought cannot be reconciled with fuel used.
11. **Retiring (archiving)** a machine, operator or customer has **no safety checks and cannot be undone**. Money owed to or by them can disappear from the totals.
12. **Service records cannot be corrected or deleted.**
13. **Customer and machine names on old bills change** when the customer or machine record is edited.

## 6. Major missing or incomplete processes

- **Hire terms.** Only hourly rates for Bucket and Breaker work. No daily, shift, monthly or contract hire, minimum hours, standby or overtime. Chaining and other tools have no site rate, so they count as ₹0 in reports until they are billed.
- **Profit by machine, site or customer.** Not available. Costs are not linked to sites, and salary is not split by machine.
- **Payments.** No customer advances, no single receipt covering several bills, no receipts as documents, no refunds, no TDS.
- **GST.** No inter-state (IGST), no GST bill-number series, no credit notes, no HSN/SAC codes.
- **Operators.** No attendance, overtime, payslips, or recovery schedule for advances.
- **Site close-out.** Marking a site "Completed" changes nothing else.
- **Built but not shown.** "Overdue payments" and "operator performance" widgets exist but are not displayed. There are no due dates on bills.
- **Access.** Only one login per business. No staff or accountant access, and the owner cannot view the change history.

## 7. Where to read more

| Question | Document |
|---|---|
| What modules exist and how are they reached? | 01_COMPLETE_MODULE_MAP.md |
| What can I do, action by action? | 02_MASTER_FEATURE_REGISTER.md |
| Exactly how does a feature behave, field by field? | 03_MODULE_DEEP_DIVES/ (six files) |
| How does a whole business process run end to end? | 04_END_TO_END_BUSINESS_WORKFLOWS.md |
| What are the exact formulas? | 05_BUSINESS_RULES_AND_CALCULATIONS.md |
| What states does each record go through? | 06_RECORD_LIFECYCLE_AND_STATUSES.md |
| How do modules feed each other? | 07_CROSS_MODULE_DATA_FLOW.md |
| What happens when things go wrong? | 08_REAL_WORLD_SCENARIOS_AND_EXCEPTIONS.md |
| What is missing, and how important is it? | 09_FUNCTIONAL_GAPS_AND_MISSING_CAPABILITIES.md |
| Why don't the reports agree, and how do I reconcile them? | 10_REPORTS_AND_FINANCIAL_RECONCILIATION.md |
| Where is the proof for each finding? | 11_EVIDENCE_REGISTER.md |
| Was everything covered? | 12_AUDIT_COVERAGE_CHECKLIST.md |

## 8. Confidence and limits

- **Tracing.** Every important finding was traced through the product's own logic (evidence grade B).
- **Independent re-checks.** The findings that affect money were re-checked independently by the main investigator: GAP-001, 002, 003, 005 and 006, the profit formula, and the meter reset on approval.
- **One finding is not yet confirmed.** GAP-012 (Site Analysis possibly dropping a job's hours) is marked unverified.
- **Not observed live.** Nothing was observed in a running app. Behaviour that depends on the server's time zone (date filters, the daily bill limit) is unverified.
