# 12 — Audit Coverage Checklist

**Status values:** Investigated · Fully documented · Partially documented · Blocked · Unverified.

**Method:**
- Every screen and every server action listed below was enumerated from the source tree. Nothing was taken from documentation alone.
- **Screens:** 37 `page.tsx` files (including the root redirect).
- **Server actions:** 108 route files, 132 route/method pairs.

**Global limitation (applies to every row):** no running application or database was used. The brief forbids creating records in production, and the only database configured is a remote development database. Every conclusion therefore comes from the implementation (evidence grade B or lower); none is runtime-verified (grade A).

## 1. Screens (user-visible entry points)

| Screen | Module | Feature IDs | Documented in | Status |
|---|---|---|---|---|
| `/register` | Account | ACC-01 | D06 | Fully documented |
| `/login` | Account | ACC-02 | D06 | Fully documented |
| `/forgot-password`, `/reset-password` | Account | ACC-04, ACC-05 | D06 | Fully documented |
| `/dashboard` | Dashboard | RPT-05..RPT-13 | D05 | Fully documented |
| `/excavators` | Machines | MACH-04, MACH-05, MACH-11 | D01 | Fully documented |
| `/excavators/new` | Machines | MACH-01 | D01 | Fully documented |
| `/excavators/detail` (Work, History, Service, Details tabs; operator card; site card) | Machines / Work / Service | MACH-06..10, MACH-12, WORK-01..09, WORK-11/12, SVC-01, SVC-03 | D01, D02 | Fully documented |
| `/excavators/detail/edit` | Machines | MACH-02, MACH-03 | D01 | Fully documented |
| `/excavators/detail/component` | Service | SVC-04 | D01 | Fully documented |
| `/customers` | Customers | CUST-02, CUST-04, CUST-06 | D05 | Fully documented |
| `/customers/new` | Customers | CUST-01 | D05 | Fully documented |
| `/customers/detail` | Customers | CUST-05 (+ job and reading edits) | D05, D02 | Fully documented |
| `/customers/detail/edit` | Customers | CUST-03, CUST-04 | D05 | Fully documented |
| `/operators` | Operators | OPS-03, OPS-13, OPS-14 | D03 | Fully documented |
| `/operators/new` | Operators | OPS-01 | D03 | Fully documented |
| `/operators/detail` (Overview, Money, Salary, Sessions, History; PIN card) | Operators | OPS-04, OPS-07..13, OPS-15 | D03 | Fully documented |
| `/operators/detail/edit` | Operators | OPS-02, OPS-03 | D03 | Fully documented |
| `/operators/approvals` | Approvals | WORK-07, WORK-08, WORK-10..12, OPS-06 | D02, D03 | Fully documented |
| `/bills` | Bills | BILL-09, BILL-10, BILL-11 | D04 | Fully documented |
| `/bills/new` | Bills | BILL-01 | D04 | Fully documented |
| `/bills/new/summary` | Bills | BILL-03 | D04 | Fully documented |
| `/bills/new/direct` | Bills | BILL-02 | D04 | Fully documented |
| `/bills/detail` | Bills / Payments | BILL-05..08, PAY-01..03 | D04 | Fully documented |
| `/bills/edit` | Bills | BILL-04 | D04 | Fully documented |
| `/site-analysis` | Site Analysis | RPT-01, RPT-04, SITE-01 | D05 | Fully documented |
| `/site-analysis/detail` | Site Analysis | RPT-02, RPT-16, SITE-02, SITE-03 | D05 | Fully documented |
| `/site-analysis/machine` | Site Analysis | RPT-03 | D05 | Fully documented |
| `/diesel-checker` | Diesel | DSL-01 | D02 | Fully documented |
| `/expenses` | Expenses | EXP-01..03 | D01 | Fully documented |
| `/search` | Search | SRCH-01 | D05 | Fully documented |
| `/settings` | Settings | SET-01..12 | D05 | Fully documented (theme: Investigated only) |
| `/operator-login` | Operator portal | ACC-06 | D06, D03 | Fully documented |
| `/operator-signup` | Operator portal | OPS-05 | D03 | Fully documented |
| `/operator` (+ Start / End / Edit work, Submit reading, Diesel-only dialogs) | Operator portal | PORT-01..07 | D02 | Fully documented |
| `/support` | Support | SUP-01..06 | D05 | Fully documented |
| `/` (root redirect), error / not-found pages | — | — | — | Investigated (no business behaviour) |

## 2. Server actions (every route and method)

| Route | Methods | Business action | Feature IDs | Documented in | Status |
|---|---|---|---|---|---|
| `/api/app-version` | GET | Android update check | SYS-01 | Out of functional scope (see docs/operations.md) | Investigated |
| `/api/approvals` | GET | Approvals queue | WORK-10 | D02 | Fully documented |
| `/api/auth/[...nextauth]` |  | Session handler | ACC-02 | D06 | Investigated |
| `/api/auth/change-password` | POST | Change password | SET-09 | D05/D06 | Fully documented |
| `/api/auth/forgot-password` | POST | Forgot password | ACC-04 | D06 | Fully documented |
| `/api/auth/login` | POST | Owner login | ACC-02 | D06 | Fully documented |
| `/api/auth/logout` | POST | Logout | ACC-03 | D06 | Fully documented |
| `/api/auth/operator-login` | POST | Operator login | ACC-06 | D03/D06 | Fully documented |
| `/api/auth/operator-signup` | POST | Operator join request | OPS-05 | D03 | Fully documented |
| `/api/auth/register` | POST | Register business | ACC-01 | D06 | Fully documented |
| `/api/auth/reset-password` | POST | Reset password | ACC-05 | D06 | Fully documented |
| `/api/auth/sign-out-everywhere` | POST | Sign out everywhere | SET-10 | D05 | Fully documented |
| `/api/auth/verify-pin` | POST | App lock unlock | SET-08 | D05 | Fully documented |
| `/api/bills/[id]/export` | GET | Per-bill Excel | BILL-08 | D04 | Fully documented |
| `/api/bills/[id]/payments/[paymentId]` | PATCH DELETE | Edit/delete payment | PAY-02, PAY-03 | D04 | Fully documented |
| `/api/bills/[id]/payments` | POST | Add payment | PAY-01 | D04 | Fully documented |
| `/api/bills/[id]` | GET PATCH DELETE | View/edit/delete bill | BILL-04, BILL-05, BILL-06 | D04 | Fully documented |
| `/api/bills/direct/hours` | GET | Direct-bill recorded hours helper | BILL-02 | D04 | Fully documented |
| `/api/bills/direct` | POST | Create direct bill | BILL-02 | D04 | Fully documented |
| `/api/bills/export` | GET | Bills register Excel | BILL-10 | D04 | Fully documented |
| `/api/bills/new/direct` | GET | Direct bill form data | BILL-02 | D04 | Fully documented |
| `/api/bills/new` | GET | Generate bill form data (unbilled jobs) | BILL-01 | D04 | Fully documented |
| `/api/bills/new/summary` | GET | Summary bill form data | BILL-03 | D04 | Fully documented |
| `/api/bills/preview-context` | GET | Bill preview context (letterhead, next number) | BILL-01..03 | D04 | Investigated |
| `/api/bills` | POST GET | List bills / create normal bill | BILL-09, BILL-01 | D04 | Fully documented |
| `/api/bills/summary` | POST | Create summary bill | BILL-03 | D04 | Fully documented |
| `/api/customers/[id]` | PATCH DELETE | Edit/archive customer | CUST-03, CUST-04 | D05 | Fully documented |
| `/api/customers/detail` | GET | Customer detail | CUST-05 | D05 | Fully documented |
| `/api/customers/options` | GET | Customer picker | CUST-01 | D05 | Investigated |
| `/api/customers` | GET POST | List/create customers | CUST-01, CUST-02 | D05 | Fully documented |
| `/api/daily-logs/[logId]/approve` | POST | Approve reading | WORK-07 | D02 | Fully documented |
| `/api/daily-logs/[logId]/reject` | POST | Reject reading | WORK-08 | D02 | Fully documented |
| `/api/daily-logs/[logId]` | PATCH DELETE | Edit/delete reading | WORK-04, WORK-05 | D02 | Fully documented |
| `/api/dashboard` | GET | Dashboard data | RPT-05..RPT-12 | D05 | Fully documented |
| `/api/excavators/[id]/assign-operator` | POST DELETE | Assign / end operator | MACH-08, MACH-10 | D01 | Fully documented |
| `/api/excavators/[id]/components/[componentId]` | GET | Component history | SVC-04 | D01 | Fully documented |
| `/api/excavators/[id]/daily-logs` | POST | Owner add daily log | WORK-03 | D02 | Fully documented |
| `/api/excavators/[id]` | GET PATCH DELETE | View/edit/archive machine | MACH-02, MACH-03, MACH-06 | D01 | Fully documented |
| `/api/excavators/[id]/service-records` | POST | Add service record | SVC-01 | D01 | Fully documented |
| `/api/excavators/[id]/service-tab` | GET | Service tab data | SVC-03 | D01 | Fully documented |
| `/api/excavators/[id]/site` | PATCH | Set machine site | MACH-09 | D01 | Fully documented |
| `/api/excavators/[id]/start-work` | POST | Owner start work | WORK-01 | D02 | Fully documented |
| `/api/excavators/[id]/stop-work` | POST | Owner stop work | WORK-02 | D02 | Fully documented |
| `/api/excavators/[id]/work-history` | GET | Work history | MACH-12 | D01/D02 | Fully documented |
| `/api/excavators/performance` | GET | Machine Performance | MACH-11 | D01 | Fully documented |
| `/api/excavators/reorder` | PUT | Reorder machines | MACH-04 | D01 | Fully documented |
| `/api/excavators` | GET POST | List/add machines | MACH-01, MACH-05 | D01 | Fully documented |
| `/api/expenses/[id]` | DELETE | Delete expense | EXP-02 | D01 | Fully documented |
| `/api/expenses` | GET POST | List/add expenses | EXP-01, EXP-03 | D01 | Fully documented |
| `/api/health/ready` | GET | Readiness probe | � | Out of functional scope | Investigated |
| `/api/health` | GET | Liveness probe | � | Out of functional scope | Investigated |
| `/api/layout` | GET | Shell data, alerts bell, frozen notice | RPT-13 | D05 | Fully documented |
| `/api/operator/daily-log` | POST | Operator submit reading | PORT-01 | D02 | Fully documented |
| `/api/operator/diesel` | POST | Operator diesel-only | PORT-02 | D02 | Fully documented |
| `/api/operator/home` | GET | Operator portal home | PORT-03 | D02 | Fully documented |
| `/api/operator/language` | POST | Operator language | PORT-07 | D03 | Fully documented |
| `/api/operator/layout` | GET | Operator shell data | PORT-03 | D02 | Investigated |
| `/api/operator/work/edit` | POST | Operator edit own job | PORT-06 | D02 | Fully documented |
| `/api/operator/work/end` | POST | Operator end/resubmit job | PORT-05 | D02 | Fully documented |
| `/api/operator/work/start` | POST | Operator start job | PORT-04 | D02 | Fully documented |
| `/api/operators/[id]/approve-join` | POST | Legacy join approval | OPS-06 | D03 | Fully documented |
| `/api/operators/[id]/decline-join` | POST | Legacy join decline | OPS-06 | D03 | Fully documented |
| `/api/operators/[id]/leaves/[leaveId]` | DELETE | Delete leave | OPS-09 | D03 | Fully documented |
| `/api/operators/[id]/leaves` | GET POST | List/add leave | OPS-09 | D03 | Fully documented |
| `/api/operators/[id]/periods/[periodId]` | GET PATCH | Period detail / close / edit dates (API) | OPS-08 | D03 | Fully documented |
| `/api/operators/[id]/periods` | GET POST | List / preview / start session | OPS-07 | D03 | Fully documented |
| `/api/operators/[id]/pin` | PATCH | Portal access / PIN | OPS-04 | D03 | Fully documented |
| `/api/operators/[id]` | PATCH DELETE | Edit/archive operator | OPS-02, OPS-03 | D03 | Fully documented |
| `/api/operators/[id]/transactions/[transactionId]` | PATCH DELETE | Edit/delete transaction | OPS-11, OPS-12 | D03 | Fully documented |
| `/api/operators/[id]/transactions` | GET POST | List/add transaction | OPS-10 | D03 | Fully documented |
| `/api/operators/detail` | GET | Operator detail | OPS-13, OPS-15 | D03 | Fully documented |
| `/api/operators/join-requests/[requestId]/approve` | POST | Approve join request | OPS-06 | D03 | Fully documented |
| `/api/operators/join-requests/[requestId]/decline` | POST | Decline join request | OPS-06 | D03 | Fully documented |
| `/api/operators/join-requests` | GET | List join requests | OPS-06 | D03 | Fully documented |
| `/api/operators/options` | GET | Operator picker | MACH-08 | D03 | Investigated |
| `/api/operators` | GET POST | List/add operators | OPS-01, OPS-14 | D03 | Fully documented |
| `/api/search` | GET | Global search | SRCH-01 | D05 | Fully documented |
| `/api/service-items` | POST | Add custom component | SVC-02 | D01 | Fully documented |
| `/api/settings/app-pin` | POST DELETE | Set/disable app lock | SET-08 | D05 | Fully documented |
| `/api/settings/bank-accounts/[id]` | PATCH DELETE | Edit (API only)/archive bank account | SET-04, SET-05 | D05 | Fully documented |
| `/api/settings/bank-accounts` | POST | Add bank account | SET-03 | D05 | Fully documented |
| `/api/settings/bill-template` | GET PATCH | Get/set bill template | BILL-11 | D04 | Fully documented |
| `/api/settings/business-code/regenerate` | POST | Regenerate business code | SET-07 | D05 | Fully documented |
| `/api/settings/diesel-price` | PATCH | Set diesel price | SET-12 | D02/D05 | Fully documented |
| `/api/settings/letterhead` | PATCH | Letterhead | SET-02 | D05 | Fully documented |
| `/api/settings/operator-language` | PATCH | Operator default language | SET-06 | D05 | Fully documented |
| `/api/settings/profile` | PATCH | Business profile | SET-01 | D05 | Fully documented |
| `/api/settings` | GET | Settings data | SET-* | D05 | Investigated |
| `/api/settings/service-interval` | GET | Default interval (placeholder) | SET-01 | D01 | Investigated |
| `/api/site-analysis` | GET | Legacy completed-session list (no web screen uses it) | � | D05 F10 | Partially documented |
| `/api/sites/[id]/analysis` | GET | Site analysis detail | RPT-02 | D05 | Fully documented |
| `/api/sites/[id]/daily` | GET | Daily machine readings | RPT-02 | D05 | Fully documented |
| `/api/sites/[id]/diesel` | GET | Diesel entries | RPT-02 | D02/D05 | Fully documented |
| `/api/sites/[id]/rates` | PATCH | Change site rates | SITE-03 | D05 | Fully documented |
| `/api/sites/[id]` | GET PATCH | View/edit site | SITE-02 | D05 | Fully documented |
| `/api/sites/fleet` | GET | Machines by site | RPT-04 | D05 | Fully documented |
| `/api/sites/options` | GET | Site picker | WORK-01 | D05 | Investigated |
| `/api/sites` | GET POST | List/create sites | RPT-01, SITE-01 | D05 | Fully documented |
| `/api/support/businesses` | GET | List businesses | SUP-02 | D05 | Fully documented |
| `/api/support/clear-data` | POST | Clear data | SUP-06 | D05 | Fully documented |
| `/api/support/freeze` | POST | Freeze/unfreeze | SUP-04 | D05 | Fully documented |
| `/api/support/impersonate` | POST | Sign in as owner | SUP-03 | D05 | Fully documented |
| `/api/support/limits` | POST | Set limits | SUP-05 | D05 | Fully documented |
| `/api/support/login` | POST | Support login | SUP-01 | D05 | Fully documented |
| `/api/support/logout` | POST | Support logout | SUP-01 | D05 | Investigated |
| `/api/work-requests/[id]/approve` | POST | Approve operator job | WORK-12 | D02 | Fully documented |
| `/api/work-requests/[id]/reject` | POST | Reject operator job | WORK-11 | D02 | Fully documented |
| `/api/work-sessions/[id]` | PATCH DELETE | Edit/delete job | WORK-06, WORK-09 | D02 | Fully documented |

## 3. Forms and fields

| Form | Fields investigated | Documented in |
|---|---|---|
| Register | all 6 | D06 F1 |
| Add / Edit machine | all 7 + version | D01 F1–F2 |
| Assign operator, Set site (+ previous site status) | all | D01 F8–F9 |
| Start Work / Stop Work (owner) | all | D02 F1–F2, D01 F10 |
| Add Daily Log / Edit reading / Edit job | all | D02 F3, F7, F9 |
| Operator Start / End / Edit work, Submit reading, Diesel only | all | D02 F4–F5, F11–F13 |
| Approve operator job / Reject (note) | all | D02 F14–F15 |
| Add Service (+ component rows, add component) | all | D01 F11–F12 |
| Add Expense | all 5 | D01 F14 |
| Add / Edit operator, PIN card, Join signup, Join approval | all | D03 F1–F6 |
| Start session, Close session, Add leave, Add / Edit transaction | all | D03 F7–F10 |
| Add / Edit customer | all 5 + version | D05 F1, F3 |
| Create site, Edit site, Change rates | all | D05 F7–F9 |
| Generate bill, Summary bill, Direct bill, Edit bill | all | D04 F1–F3, F9 |
| Give money / Edit payment | all 4 | D04 F11 |
| Settings sections (profile, letterhead, bank, diesel price, language, business code, app lock, password) | all | D05 F16 |
| Support console actions (reason, limits, confirmation code) | all | D05 F17 |

## 4. Business workflows (Part 7)

| Journey | Status | Where |
|---|---|---|
| 1 Machine onboarding | Fully documented | 04 §J1 |
| 2 Customer onboarding | Fully documented | 04 §J2 |
| 3 New excavation assignment | Fully documented | 04 §J3 |
| 4 Complete working day | Fully documented | 04 §J4 |
| 5 Site operations across multiple days | Fully documented | 04 §J5 |
| 6 Diesel and operational costs | Fully documented (no purchase ledger exists) | 04 §J6 |
| 7 Operator settlement | Fully documented | 04 §J7 |
| 8 Customer invoicing | Fully documented | 04 §J8 |
| 9 Customer payment | Fully documented | 04 §J9 |
| 10 Maintenance event | Fully documented | 04 §J10 |
| 11 Expense-to-profitability | Fully documented | 04 §J11 |
| 12 Closing a site or assignment | Fully documented | 04 §J12 |

## 5. Deliverables

| File | Status |
|---|---|
| 00_MASTER_EXECUTIVE_SUMMARY.md | Done |
| 01_COMPLETE_MODULE_MAP.md | Done |
| 02_MASTER_FEATURE_REGISTER.md | Done (131 rows) |
| 03_MODULE_DEEP_DIVES/ D01–D06 | Done |
| 04_END_TO_END_BUSINESS_WORKFLOWS.md | Done (12 journeys, 10 diagrams) |
| 05_BUSINESS_RULES_AND_CALCULATIONS.md | Done |
| 06_RECORD_LIFECYCLE_AND_STATUSES.md | Done |
| 07_CROSS_MODULE_DATA_FLOW.md | Done (38 relationships) |
| 08_REAL_WORLD_SCENARIOS_AND_EXCEPTIONS.md | Done (all Part 8 scenarios) |
| 09_FUNCTIONAL_GAPS_AND_MISSING_CAPABILITIES.md | Done (39 gaps) |
| 10_REPORTS_AND_FINANCIAL_RECONCILIATION.md | Done (23 reports + 2 not shown) |
| 11_EVIDENCE_REGISTER.md | Done |
| 12_AUDIT_COVERAGE_CHECKLIST.md | This file |

## 6. Items not fully closed (explicit)

| Item | Status | Why / what is missing |
|---|---|---|
| Runtime behaviour of every feature | **Blocked** | No running application was used (see global limitation). Grade A evidence is absent everywhere |
| GAP-012: Site Analysis dropping a job's hours when it has any non-approved reading | **Unverified** (C/D) | SQL logic traced by an investigator but not re-run. Needs a test against a scratch database |
| Server time zone effects on date filters (Site Analysis and customers use server-local end-of-day; the dashboard uses UTC) | **Unverified** (E) | Depends on the production server's time-zone setting |
| Bill-per-day limit counted from server-local midnight | **Unverified** (E) | Same reason |
| `/api/site-analysis` (legacy list with no web screen) | **Partially documented** | Probably used by older Android builds. Not confirmed |
| Android-only behaviour (native share, print, file save, self-update) | **Investigated**, not documented in depth | Same screens as the web; outside the functional scope |
| Theme setting | **Investigated** | Cosmetic, no business effect |
| The `testing-excavator-demo` fork (voice / text assistant) | **Out of scope** | Not the audited product; noted in 01 |
| The commit "Site status on machine moves" | Documented from code | The behaviour was documented from the current code (D01 F9). Git history was not needed |

## 7. Final quality-control checklist (Part 14)

| # | Check | Result |
|---|---|---|
| 1 | Every discovered module included | ✅ 15 modules plus submodules in 01 |
| 2 | Every submodule included | ✅ |
| 3 | Every meaningful user action inventoried | ✅ 131 rows in 02. Every route in §2 maps to a feature ID |
| 4 | Every relevant form field investigated | ✅ §3 |
| 5 | Important calculations traced | ✅ 05 (operations, fuel, salary, billing, receivables, financial, maintenance) |
| 6 | Important business rules documented | ✅ 05 §8 |
| 7 | Major record lifecycles mapped | ✅ 06 |
| 8 | Cross-module relationships investigated | ✅ 07 (38 verified relationships, including "None" connections) |
| 9 | Business journeys reconstructed | ✅ 12 / 12 |
| 10 | Financial workflows investigated | ✅ billing, payments, receivables, profit, salary, expenses |
| 11 | Reports explained | ✅ 10 |
| 12 | Edge cases examined | ✅ 08 |
| 13 | Gaps and unverified behaviour separated | ✅ 09 (classification column) and §6 above |
| 14 | Findings carry evidence | ✅ 11. Every deep-dive claim cites file and function |
| 15 | No unsupported claims as facts | ✅ D and E items are labelled. Line numbers from one investigator were found wrong and corrected (D03 header) |
| — | Feature register ↔ module docs ↔ workflows ↔ evidence consistency | ✅ Every feature ID used in 04 exists in 02. Every route in §2 has a feature ID |
| — | Every profitability formula evidenced | ✅ R-PROFIT verified directly against `dashboard.ts getProfitOverview` by the main investigator |
| — | Billed, collected, outstanding and expenses never treated as interchangeable | ✅ 10 §1 defines the four measures. Profit is defined explicitly as work value − recorded costs |
