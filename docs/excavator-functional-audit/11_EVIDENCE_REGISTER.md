# 11 — Evidence Register

This register indexes the key findings so each one can be traced back to the source.

## How to read this register

**Evidence categories (as defined by the brief):**

| Grade | Meaning |
|---|---|
| A | Runtime-verified. **None in this audit**, because no application was run. |
| B | End-to-end implementation traced. |
| C | Partly traced. |
| D | Inferred. |
| E | Unverified. |

**"MI-verified"** means the main investigator re-read the cited code personally, in addition to the domain investigator. Other rows rest on the domain investigator's trace recorded in the deep dive.

**Paths** are relative to `excavator-manager/`. **Line numbers** are as read on 2026-11-24. The **function name is the authoritative locator**.

**Known correction:** the operators investigator cited wrong line numbers for `salary.ts` and `operatorAssignments.ts`. The corrected locations are in the header of D03 and are used below.

## A. Money and billing

| # | Finding | Source file → function (lines) | Ev. | MI-verified | Detail |
|---|---|---|---|---|---|
| E-01 | Work counts as "billed" only when a normal-bill line links to it | `src/lib/services/siteAnalysis.ts` → `entriesCte` (join on `BillItem.workSessionId`, ~L164); `getCustomerUnbilledWork` (`WHERE NOT v.billed`); `src/lib/services/bills.ts` → `listUnbilledWorkSessions` (`billItems: { none: {} }`, L375), `createBill` (L434) | B | ✅ | D04 G1 |
| E-02 | Direct bills create no bill lines and no work link; Summary lines have no work link | `bills.ts` → `createDirectBill` (L664-736), `buildSummaryLines` / `createSummaryBill` (L540-614) | B | — | D04 F2, F3 |
| E-03 | Machine Performance adds the Direct-bill `totalAmount`; Profit adds the Direct-bill `subtotal` | `siteAnalysis.ts` → `getMachineEarnings` (L360-363, L400-404); `src/lib/services/dashboard.ts` → `getProfitOverview` (L908) | B | ✅ | D01 F13 |
| E-04 | Bill line = round2(round2(h) × round2(r)); total = round2(taxable + GST − diesel advance); CGST = round2(tax/2), SGST = tax − CGST; IGST always null | `src/lib/money.ts` → `round2`, `lineAmount`, `gstSplit`, `paymentStatus` (L33-73); `bills.ts` → `normalBillTotals` (L275-296), `directBillAmounts` (L618-657) | B | — | D04 §3 |
| E-05 | Bill-total, GST and payment invariants are re-checked by the integrity checker | `docs/invariants.md`; `scripts/lib/integrity-checks.mjs` | B | ✅ (doc read) | 10 §3.1 |
| E-06 | Payment ≤ remaining balance; amount > 0; status re-derived | `bills.ts` → `addPayment` (L1160-1210), `updatePayment` (L1214-1278), `deletePayment` (L1280-1319); migration `20261004091000_security_and_integrity` (CHECKs) | B | — | D04 F11 |
| E-07 | A payment requires a bill (no advance / unallocated receipts) | `prisma/schema.prisma` → `model Payment` (`billId String`, non-null) | B | ✅ | D04 F11 |
| E-08 | Bill edit allowed at any time; total ≥ paid; letterhead re-stamped | `bills.ts` → `updateBill` (L752-926; re-stamp L782-788; below-paid check L879-884) | B | — | D04 F9 |
| E-09 | Bill delete cascades payments and lines; no cancel status | `bills.ts` → `deleteBill` (L931-959); schema `BillItem`/`Payment` `onDelete: Cascade` | B | ✅ (schema) | D04 F10 |
| E-10 | Non-GST numbering `NG-0001`; GST numbers manual | `bills.ts` → `resolveBillNumber` / `reserveBillNumber` (L187-219, L523-538); `src/lib/validation/bill.ts` (L140-143) | B | — | D04 F5 |
| E-11 | Customer name, address and mobile on bills are read live | `bills.ts` → `toBillPreviewData` (L1095-1143, customer fields ~L1099-1102) | B | — | D05 F3 |
| E-12 | Customer Total / Pending include unbilled work value | `src/lib/services/customers.ts` → `getCustomerDetail` (L277-280), `listCustomers` (L83) | B | ✅ | D05 C1-C3 |
| E-13 | Billed / received / pending arithmetic shared across screens | `src/lib/services/financials.ts` (L1-63) | B | ✅ | 05 RC-* |
| E-14 | Dashboard Total = all bills + unbilled; Pending = Total − all payments | `dashboard.ts` → `getDashboardSummary` (L479-501) | B | ✅ (comment L492-498 read) | D05 R11-R12 |

## B. Profit and expenses

| # | Finding | Source | Ev. | MI-verified | Detail |
|---|---|---|---|---|---|
| E-20 | Profit = work value + other bill lines + charges − discount − (salary + maintenance + diesel + other); GST excluded | `dashboard.ts` → `getProfitOverview` (L879-1016) | B | ✅ (read in full) | 05 R-PROFIT |
| E-21 | Maintenance = service-record cost + REPAIR/SERVICE/PARTS/TYRES expenses (double-count risk) | `dashboard.ts` L945-947 | B | ✅ | GAP-006 |
| E-22 | Diesel cost per machine: DIESEL expenses, else litres × Settings price, else uncosted | `dashboard.ts` L950-972 | B | ✅ | 05 FU-7 |
| E-23 | Salary cost = Σ (calendar-month base + bonus), prorated per range, capped at today; whole month when no range is passed | `dashboard.ts` → `salaryCostForMonth` (L1019-1023), `salaryCostForRange` (L1030-1059), L929 | B | ✅ | 05 R-PROFIT |
| E-24 | Expenses: list (latest 200), create, delete; no update | `src/lib/services/expenses.ts` (L15-77); `src/app/api/expenses/route.ts` (GET, POST), `[id]/route.ts` (DELETE) | B | ✅ | D01 F14 |
| E-25 | Expense types DIESEL, REPAIR, SERVICE, PARTS, TYRES, TRANSPORT, OTHER | `src/lib/validation/expense.ts` (L3-12) | B | — | D01 F14 |

## C. Machines, work and meter

| # | Finding | Source | Ev. | MI-verified | Detail |
|---|---|---|---|---|---|
| E-30 | "SERVICE" status is read but never written | grep `"SERVICE"` → only `dashboard.ts` L524 (`underService`) and `status-badge.tsx` | B | ✅ | GAP-007 |
| E-31 | Approving an operator job sets the machine IDLE, meter = end, site = approved site, unconditionally | `src/lib/services/operatorWorkRequests.ts` → `approveWorkRequest` (L461-464) | B | ✅ | GAP-008 |
| E-32 | Start Work sets the machine meter to the typed start value (no continuity check) | `src/lib/services/workSessions.ts` → `startWork` (L229-232) | B | — | D02 F1 |
| E-33 | Job hours = Σ approved WORK readings, else meter difference | `workSessions.ts` → `stopWork` (L274-275), approvedHours helper (L70-76) | B | — | 05 OP-3 |
| E-34 | Hours from meter / clock formulas (midnight +24 h) | `src/lib/utils/hours.ts` (L8-23) | B | — | 05 OP-1/2 |
| E-35 | One live reading per job per day | migration `20261004100000_integrity_indexes` (L22-24, partial unique index) | B | — | D02 §0 |
| E-36 | Billed jobs can be edited; only delete is refused | `workSessions.ts` → `updateWorkSession` (L909-994), `deleteWorkSession` (L998-1037) | B | — | GAP-004 |
| E-37 | Diesel-only entry attaches to the active job, else the most recent job of any status | `workSessions.ts` → `submitDieselOnly` (L509-517) | B | — | GAP-011 |
| E-38 | Owner cannot cancel an ACTIVE operator job; it blocks owner Start Work | `workSessions.ts` → `startWork` (L204-210); no cancel route in `src/app/api/work-requests` | B | ✅ (route list) | GAP-009 |
| E-39 | Archive of a machine sets only a flag; no checks; no restore | `src/lib/services/excavators.ts` → `archiveExcavator` (L223-251) | B | — | GAP-014 |
| E-40 | One operator ↔ one machine; assignment dated "now" | `src/lib/services/operatorAssignments.ts` → `assignOperator` (L19-101) | B | ✅ (location) | BR-1 |
| E-41 | Assignment history functions unused | `operatorAssignments.ts` L162-176; no importers | B | — | GAP-030 |
| E-42 | Service status / next-due formula | `src/lib/services/serviceStatus.ts` → `computeServiceStatus` (L21-34); `serviceRecords.ts` → `createServiceRecord` (L247-254, L285-292) | B | — | 05 MA-1/2 |
| E-43 | Service records cannot be updated or deleted | `serviceRecords.ts` (create only); no PATCH/DELETE route under `excavators/[id]/service-records` | B | ✅ (route methods) | GAP-015 |
| E-44 | Site status never blocks work | `workSessions.ts` → `startWork` site by name (L212); `sites.ts` → `findOrCreateSite` (L27-34) | B | — | BR-8 |
| E-45 | Effective-dated rate selection; earliest row used for work before the first rate | `siteAnalysis.ts` → `entriesCte` rate join (L145-174); `sites.ts` → `updateSiteRates` (L144-193) | B | — | BR-9 |
| E-46 | Site Analysis drops session-level hours once a job has any reading | `siteAnalysis.ts` → `entriesCte` (`NOT EXISTS` with no status filter, ~L124) | C/D | — | GAP-012 |

## D. Operators and salary

| # | Finding | Source | Ev. | MI-verified | Detail |
|---|---|---|---|---|---|
| E-50 | Calendar-month base = constant monthly salary for every month (simple-shape operator) | `src/lib/services/salary.ts` → `computeSalaryForMonth` (L97-148, base selection L124-131) | B | ✅ | GAP-005 |
| E-51 | Daily anniversary-cycle accrual | `src/lib/services/salaryCore.ts` → `accrueBaseSalary` (L82-127) | B | — | 05 SA-2 |
| E-52 | Period-based accrual, leave, carry forward | `src/lib/services/workingPeriods.ts` → `calculateOperatorPeriods` (L282-513) | B | ✅ (location) | 05 SA-4 |
| E-53 | Transaction classification (payment / bonus / deduction / ignored) | `salaryCore.ts` → `isDeduction` (L21), `applyTransaction` (L27) | B | ✅ (location) | 05 SA-1 |
| E-54 | Dashboard salary due = Σ max(0, owed) | `salary.ts` → `getTotalSalaryDue` (L423-435) | B | ✅ | 05 SA-7 |
| E-55 | Start New Session rules and carry forward | `src/lib/services/workingPeriodActions.ts` → `planStart` (L66-178), `startWorkingPeriod` (L208-356) | B | ✅ (location) | D03 F7 |
| E-56 | Operator archive: flag only, no balance check | `src/lib/services/operators.ts` → `archiveOperator` (L278-306) | B | ✅ (location) | GAP-014 |
| E-57 | Join request: 7-day expiry, 6-digit code, 5 attempts | `operators.ts` → `requestOperatorJoin` (L499-565), `approveJoinRequest` (L669-787) | B | ✅ (location) | D03 F5-F6 |
| E-58 | Join-approved operator created with salary 0, no period | `operators.ts` → `approveJoinRequest` (~L748-753) | B | — | GAP-023 |

## E. Customers, reports, settings, access

| # | Finding | Source | Ev. | MI-verified | Detail |
|---|---|---|---|---|---|
| E-60 | Overdue Payments and Operator Performance widgets are not rendered | grep: `overdue-payments.tsx`, `operator-performance.tsx` have no importers | B | ✅ | GAP-029 |
| E-61 | Dashboard hours include readings of any status | `dashboard.ts` → `getHoursForSessionsOverlappingRange` (L361-380), `getMonthlyHoursTrend` (L284-334) | B | — | GAP-017 |
| E-62 | Payment Collection "Overdue" = nothing paid (no age rule) | `dashboard.ts` → `getPaymentCollectionStatus` (L743-799) | B | — | 05 FI-7 |
| E-63 | Customer archive: no outstanding check; no restore | `customers.ts` → `archiveCustomer` (L231-258) | B | — | GAP-014 |
| E-64 | Search scope: machines, customers, operators, bill number | `src/lib/services/search.ts` (L17-121) | B | — | GAP-034 |
| E-65 | Bank account edit only via API | `src/app/(app)/settings/bank-accounts-section.tsx` (add/delete only); `src/app/api/settings/bank-accounts/[id]/route.ts` (PATCH) | B | — | GAP-035 |
| E-66 | Registration creates the business, owner, component catalogue, money categories and code; no email verification | `src/lib/services/auth.ts` → `registerBusiness` (L37-~105); `src/lib/validation/auth.ts` `registerSchema` | B | ✅ | D06 F1 |
| E-67 | Owner session 30 days | `src/lib/auth.ts` L52 | B | ✅ | D06 F2 |
| E-68 | Only role OWNER; operator portal separate; support console capabilities | `src/lib/session.ts` (L31-34, L54, L96); `src/lib/api-auth.ts` (L6-65); `src/lib/services/support.ts` (L19-236) | B | — | D05 §4 |
| E-69 | Navigation modules | `src/components/shell/nav-items.ts` | B | ✅ | 01 |
| E-70 | Route inventory: 108 route files, 132 route/method pairs; the generated matrix omits 8 pairs | source-tree scan (see 12 §2); `docs/authorization-matrix.md` (124 pairs) | B | ✅ | 01, 12 |

## F. Documentation versus implementation discrepancies

| # | Documentation says | Implementation does | Source |
|---|---|---|---|
| X-1 | Schema: "Expenses (schema only this session — no UI yet)" | A full Expenses page and API exist | `prisma/schema.prisma` L673-675 vs `src/app/(app)/expenses/page.tsx` |
| X-2 | Schema: "Billing (schema only this session — no UI yet)" | Full billing exists | schema L694-696 vs `bills.ts` |
| X-3 | Schema: component `defaultIntervalHours` "left null unless the owner configures one" | Defaults are seeded with guide intervals; the owner cannot edit them | `serviceRecords.ts` L15-71 |
| X-4 | Schema: Site status "ACTIVE \| COMPLETED \| ON_HOLD" | PARTIAL is also allowed | `src/lib/validation/site.ts` L6-13 |
| X-5 | Schema: OperatorTransaction comment gives the salary formula as base + bonus − deductions − paid per calendar month | Three different formulas are used (see GAP-005) | `salary.ts`, `salaryCore.ts`, `workingPeriods.ts` |
| X-6 | Schema: an operator work request "never touches Excavator.currentHourMeter … until an Admin approves it" | Operator Start Work sets the machine to WORKING and sets its meter immediately | `operatorWorkRequests.ts` → `startOperatorWork` (L105-108) |
| X-7 | `getProfitOverview` docblock: salary "never for days after today" | True only when a range is passed; without a range the whole month is counted | `dashboard.ts` L888 vs L929 |
| X-8 | Dashboard comment: Pending agrees with Site Analysis | Agrees only for the unbilled part | `dashboard.ts` L492-498 vs `siteAnalysis.ts` |
| X-9 | Operator delete dialog: "permanently remove … cannot be undone" | Soft archive; data kept; no restore | `src/app/(app)/operators/delete-operator-button.tsx` L58-61 |
| X-10 | Generic archive button: "can be restored later" | No restore exists | `src/components/archive-button.tsx` L48 |
| X-11 | `docs/authorization-matrix.md` "every API route" | 8 route/method pairs are missing | see E-70 |
| X-12 | Schema / `workingPeriods.ts` refer to `docs/operations.md` for paid-leave salary rules | That document contains no such rules | `docs/operations.md` |
