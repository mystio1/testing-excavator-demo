# 09 — Functional Gaps and Missing Capabilities

This register lists what is missing, incomplete or disconnected in the product today. Existing behaviour is described in the module deep dives (03_MODULE_DEEP_DIVES/); recommendations are kept in the last column and separate from the facts.

**Classification:**

| Classification | Meaning |
|---|---|
| Implemented | Complete |
| Partially implemented | Part of the workflow is missing |
| Disconnected | The feature exists but is not wired into the flow it should feed |
| Unverified | The evidence is insufficient |
| Not located | Searched for and not found |
| Explicitly unsupported | The product prevents or refuses it |

**Priority** reflects business impact:
- **Critical** — wrong money figures or invoices
- **High** — wrong operational records or misleading figures
- **Medium** — a missing capability with a manual workaround
- **Low** — a convenience gap

## A. Critical

| Gap ID | Module | Missing capability | Existing behaviour | Why it matters | Practical example | Other modules affected | Classification | Suggested direction |
|---|---|---|---|---|---|---|---|---|
| GAP-001 | Billing | **Direct and Summary bills do not mark the work they invoice as billed** | Only a normal-bill line links to a job. Hours typed onto a Direct or Summary bill stay "not billed yet". | The same hours can be **invoiced twice**. Every "pending" and revenue figure counts the hours twice: once as the bill and once as unbilled work at site rates. | A Direct bill for Machine A, 1–15 Nov, Bucket 80 h. The 80 approved hours still appear in Generate Bill, in Customer "Work not billed yet", in Dashboard Total/Pending and in Profit revenue. | Customers, Dashboard, Site Analysis, Profit, Machine Performance | Disconnected | Link Direct and Summary lines to the covered jobs or readings, or exclude covered periods from "unbilled" |
| GAP-002 | Billing | **No cancellation, void or credit note; a paid bill can be fully edited** | Delete is permanent and also deletes the bill's payments. Edit can change customer, number, type, GST, lines and amounts at any time. Edit re-stamps the letterhead from current Settings. | An issued tax invoice can silently change or vanish. Collected money disappears from "Amount Received" when a bill is deleted. This is not compatible with GST invoice-series discipline. | A ₹50,000 GST bill is paid ₹20,000 and then deleted to "fix" it. The ₹20,000 receipt disappears from every report; only the hidden audit log remains. | Payments, Dashboard, Customers | Explicitly unsupported (cancel) / Partially implemented (edit) | Add an issued/locked state, cancellation with a reason, and credit notes |
| GAP-003 | Reports | **"Pending" mixes un-invoiced work with invoices** | Customer Pending, the WhatsApp reminder and Dashboard Pending add unbilled work, valued at site rates **without GST**, to bill balances **with GST**. | The owner may demand money that was never invoiced, at a value without GST. Receivables look larger than what is legally owed. | A customer is sent "you have a pending payment of ₹1,40,000", of which ₹60,000 is work not yet billed. | Customers, Dashboard | Partially implemented | Show "Invoiced outstanding" and "Work not yet billed" as separate figures |
| GAP-004 | Billing / Work | **Billed work is not locked** | Jobs and readings on a billed job can be edited, deleted or approved after invoicing. The bill keeps its old figures. Extra hours approved later can never be billed. The "already on a bill" warning in the job edit dialog is never shown. | Bills and work records drift apart with no warning. Late-approved hours are lost revenue. | A pending reading of 6 h is approved after the job was billed. Job hours rise by 6, the bill is unchanged, and the 6 h can never be billed. | Site Analysis, Profit | Partially implemented | Lock billed work, or flag differences and allow a supplementary bill |
| GAP-005 | Operators / Salary | **Three different salary formulas give different amounts owed** | The Overview and Operators list use daily accrual. The Sessions tab uses per-period accrual. The Salary tab, Profit and Dashboard (for simple operators) use the full monthly salary for every month, including the joining month and the current month from day 1. | The owner may pay the wrong amount. Profit's salary cost differs from what the operator screens say is owed. | Operator joins 7 Jul at ₹30,000/month. On 24 Nov the Overview shows ₹33,000 remaining and the Salary tab shows ₹46,000 payable. | Dashboard profit, Dashboard salary due | Partially implemented | Use one accrual rule everywhere |
| GAP-006 | Profit | **Maintenance cost can be counted twice** | Profit adds service-record line costs **and** expenses of type REPAIR, SERVICE, PARTS, TYRES. The two are not linked. | Profit is understated if the owner records the same service bill in both places, which the "SERVICE" expense type invites. | A ₹12,000 service is logged with line costs on the Service tab and also as a ₹12,000 SERVICE expense. Maintenance shows ₹24,000. | Dashboard | Disconnected | Remove the overlap, or link the expense to the service record |

## B. High

| Gap ID | Module | Missing capability | Existing behaviour | Why it matters / example | Classification |
|---|---|---|---|---|---|
| GAP-007 | Machines | **No breakdown / under-service state** | Status is only Idle or Working. "Under Service" is displayed but nothing ever sets it, so the dashboard count is always 0. Service records do not change status or block work. No downtime is recorded. | The owner cannot see which machines are unavailable, or how long they were down. A broken machine can still be assigned work. | Not located / Disconnected |
| GAP-008 | Work / Meter | **No hour-meter continuity checks** | The opening meter is not checked against the previous closing. Start Work with a lower meter winds the machine meter back. A final meter below the last daily reading is accepted. Approving an older operator job forces the machine to Idle and resets its meter, even while a newer job runs. | Wrong service-due figures, and hours that can be disputed. A typo of 1200 instead of 12000 at Start silently resets the meter. | Partially implemented |
| GAP-009 | Operator portal | **The owner cannot cancel an operator's in-progress job** | An ACTIVE operator job cannot be rejected, cancelled or deleted by the owner. It blocks the owner from starting work on that machine. Rejecting a submitted job leaves the machine "Working". | A forgotten operator job freezes the machine for owner-entered work. | Explicitly unsupported |
| GAP-010 | Diesel | **No fuel purchase, stock or supplier ledger** | Only litres filled and litres left in the tank, attached to work records. A DIESEL expense is an amount only, with no litres, rate or supplier. The diesel price in Settings is used only for profit costing. The Diesel Checker saves nothing. | No reconciliation of fuel bought against fuel issued, and no detection of pilferage, which is a major cost lever in this business. | Not located |
| GAP-011 | Diesel | **Diesel records can attach to the wrong job or be lost** | An operator "diesel only" entry with no active job goes to the machine's most recent job of **any** status, which can be a completed, billed job of another customer. An owner editing a reading erases its "litres left in tank". An owner job edit overwrites job diesel with the typed figure. | Diesel averages and the customer diesel advance on bills become wrong. | Partially implemented |
| GAP-012 | Reports | **Site Analysis can drop a job's hours** (investigator lead) | A job without readings counts its session hours only while it has **no readings at all**, of any status. One pending or diesel-only reading can remove the whole job's hours and diesel from Site Analysis, unbilled value and profit. | Revenue and profit understated. | Unverified (C/D): SQL traced, not runtime-tested |
| GAP-013 | Customers / Bills | **Customer and machine details on old bills change when edited** | A bill prints the *current* customer name, address and mobile, and the *current* machine name and number. The bill template is business-wide and live. | Reprinting an old invoice produces a document different from the one sent. | Partially implemented |
| GAP-014 | Machines / Operators / Customers | **Archive has no checks and no restore** | A machine can be archived while working, and still accepts jobs, services and expenses through the operator portal and API. Archiving an operator skips any balance check and does not end the machine assignment. Owed salary vanishes from totals, and past profit is restated. Archiving a customer skips any outstanding check, so its pending disappears from the Customers screen (but not from the Dashboard). Nothing can be un-archived. The operator delete dialog says "permanently remove". | Money owed by or to someone can disappear from view. | Partially implemented |
| GAP-015 | Service | **Service records cannot be edited or deleted** | Create only. A wrong meter reading permanently raises the machine meter. A 50-hour component ticked on a full service sets the next machine service at +50 h. | Maintenance alerts become wrong with no way to correct them. | Explicitly unsupported |
| GAP-016 | Payments | **No advance, unallocated or multi-bill receipt** | Every payment belongs to one bill and cannot exceed its balance. There is no receipt document or number, and no TDS, write-off, refund or "move to another bill". | Real-world receipts (advance before work, one cheque for several bills, TDS deducted) must be split or bent to fit. | Explicitly unsupported |
| GAP-017 | Reports | **Inconsistent totals between screens** | Dashboard Pending ≠ Site Analysis Pending. Dashboard Hours (all reading statuses) ≠ Hours detail (completed jobs) ≠ Site Analysis (approved only). Machine Performance adds Direct-bill totals with GST, while Profit adds the subtotal. "Customer Total Revenue" on the site page is bills only, while the customer page Total includes unbilled work. | Figures do not reconcile, which undermines trust. | Partially implemented |
| GAP-018 | Billing | **Normal bill uses one rate for every line, defaulting to today's rate** | Mixed Bucket/Breaker or multi-site jobs get one rate. The site's rate history (rate on the work date) is not used for pricing the bill, only for reports. | Under- or over-billing after a rate change. | Partially implemented |

## C. Medium

| Gap ID | Module | Missing capability / issue | Classification |
|---|---|---|---|
| GAP-019 | Hire terms | Only hourly Bucket/Breaker rates exist (Chaining and other tools are unpriced, valued at ₹0). There is no daily, shift, monthly or contract hire; no minimum hours; no standby, idle or overtime; no wet/dry hire flag; no billable-vs-actual hours. | Not located |
| GAP-020 | Profitability | No machine-wise, site-wise or customer-wise profit. Expenses and service costs have no site; salary is not allocated to machines. Machine Performance shows revenue and hours only. | Not located |
| GAP-021 | GST | No IGST / inter-state. No GSTIN format check. No GST number sequence (GST bill numbers are typed by hand). No HSN/SAC or place of supply. Buyer GSTIN is not pre-filled from the customer on normal and direct bills. | Partially implemented |
| GAP-022 | Operators | No attendance. Salary ignores work done; absence must be entered as unpaid leave. No overtime. No payslip or salary statement. Advances have no recovery schedule, and an advance not marked "deduct" is never tracked. A negative balance is not carried to a new session. Transactions in closed sessions stay editable. A salary change on Edit Operator rewrites the whole current session. | Not located / Partially implemented |
| GAP-023 | Operators | An operator approved from a join request is created with salary 0 and no stored working period. A later salary edit backdates to their creation date. | Partially implemented |
| GAP-024 | Work | Two operators cannot record separate shifts on one machine on the same day (one reading per job per day; the reading has no operator). A site change during a day is impossible inside one job. There is no meter-replacement / reset event. | Not located |
| GAP-025 | Work | Readings and job dates can be in the future. Reading dates are not bounded by the job's start and end. A daily-reading rejection has no reason field. Operators cannot withdraw a submitted reading. The approvals card shows the job's operator, not the submitter. | Partially implemented |
| GAP-026 | Expenses | No expense edit (delete and re-create only). No duplicate guard, vendor, payment mode or receipt. The list has no filters and shows only the latest 200. A DIESEL expense disables litre-based costing for that machine for the whole period. | Partially implemented |
| GAP-027 | Sites | Site status blocks nothing and triggers nothing. There is no site close-out (final reconciliation, release machines). No site delete or archive. Rate-history rows cannot be corrected. The first rate ever entered applies backwards to all earlier work. Auto-created sites have no customer and no rate, so their work is valued at ₹0. | Partially implemented |
| GAP-028 | Sites / Customers | The customer a job is attributed to is chosen per job, independently of the site's customer. Work at a "Self site" can still be valued as a customer receivable. | Partially implemented |
| GAP-029 | Dashboard | The "Overdue Payments" (15-day rule) and "Operator Performance" widgets are built but not displayed. The "Overdue" group in Payment Collection only means "nothing paid". There are no due dates or credit terms on bills. | Disconnected |
| GAP-030 | Machines | Operator assignment history is recorded but never shown. Reassigning an operator mid-job is allowed; the job keeps the old operator while the screen shows the new one. A job cannot be moved to another machine. | Disconnected / Partially implemented |
| GAP-031 | Maintenance | Component intervals cannot be edited, and custom components get none. "Component Status" reads only the latest record, so earlier-serviced parts show "Never serviced". A never-serviced component never alerts. No scheduled (calendar) servicing. | Partially implemented |
| GAP-032 | Customers | No customer statement or ledger, no ageing, no credit limit or opening balance, no duplicate-customer warning. The customer page does not list the customer's sites. | Not located |

## D. Low

| Gap ID | Issue | Classification |
|---|---|---|
| GAP-033 | Bills list and register export have no date, status or GST/Non-GST filter in the screen (the service supports dates). Summary bills cannot be filtered apart from normal bills. The per-bill Excel always uses the Standard layout and omits payments. | Partially implemented |
| GAP-034 | Search covers machines, customers, operators and bill **number** only, not sites or amounts. | Partially implemented |
| GAP-035 | A bank account cannot be edited from Settings (add and delete only; edit exists in the API). | Disconnected |
| GAP-036 | No exports for the dashboard, Site Analysis tables or customer statements. The Site Analysis PDF omits the daily readings. | Not located |
| GAP-037 | One login per business. No staff or accountant roles. The audit log cannot be viewed by the owner. | Not located |
| GAP-038 | Machine name and number uniqueness are not checked. There is no owned / rented / leased flag, purchase cost or depreciation. Archive is the only end of life. | Not located |
| GAP-039 | Text issues: "X hrs hrs worked" on the approvals card. The Expenses schema comment says "no UI yet". The generated route list in `docs/authorization-matrix.md` omits the expenses, diesel-price, bill-template, sites/fleet and direct-bill-hours routes (functional documentation drift only). | — |

## Capabilities explicitly investigated and **not located**

The following were searched for (schema, services, routes, UI) and do not exist:

- **Machines:** owned vs rented machines; breakdown / downtime records; machine transfer; machine retirement or sale.
- **Diesel:** diesel purchase, stock, supplier or tank capacity.
- **Operators:** attendance; overtime; daily or hourly wages; payslips.
- **Hire terms:** shift, daily, monthly or contract hire; minimum hours; standby time.
- **Billing:** credit notes; bill cancellation; IGST; TDS.
- **Receipts:** advance or unallocated receipts; receipt documents.
- **Profitability:** site-level expenses; site-, machine- or customer-wise profit.
- **Reporting:** customer statements; due dates and ageing; data import of any kind.
