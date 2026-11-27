# 02 — Master Feature Register

This register gives one row per user action that produces a distinct business outcome.

**Status column**
- **Implemented**: the action works as a complete business capability.
- **Partial**: works, but a material part of the expected workflow is missing.
- **Disconnected**: exists, but is not wired into the flow it should feed.
- **Not shown**: built, but not reachable in the web screens.

**Evidence column**
- Gives the deep dive (D01–D06, in `03_MODULE_DEEP_DIVES/`), its feature number, and the evidence grade.
- **B** = traced end to end. **C** = partly traced.
- No feature was runtime-verified (grade A), because no application was run.

**Deep dives**

| Code | File |
|---|---|
| D01 | 01_MACHINES_MAINTENANCE_EXPENSES |
| D02 | 02_WORK_RECORDING_HOURS_APPROVALS_DIESEL |
| D03 | 03_OPERATORS_SALARY_PERIODS |
| D04 | 04_BILLING_PAYMENTS_RECEIVABLES |
| D05 | 05_CUSTOMERS_SITES_REPORTS_DASHBOARD_SETTINGS |
| D06 | 06_ACCOUNT_ACCESS_AND_TENANCY |

## Account and access

| Feature ID | Module | Submodule | Individual action | Purpose | Status | Evidence |
|---|---|---|---|---|---|---|
| ACC-01 | Account | Register | Register a business (creates owner login, component catalogue, money categories, business code) | Open an account | Implemented | D06 F1 · B |
| ACC-02 | Account | Login | Owner login with email or phone + password | Access | Implemented | D06 F2 · B |
| ACC-03 | Account | Logout | Log out | — | Implemented | D06 F2 · B |
| ACC-04 | Account | Password | Forgot password (email link) | Recover access | Implemented | D06 F3 · B |
| ACC-05 | Account | Password | Reset password with token | Recover access | Implemented | D06 F3 · B |
| ACC-06 | Operator portal | Login | Operator login with mobile + PIN | Operator access | Implemented | D06 F5 · B |

## Machines

| Feature ID | Module | Submodule | Individual action | Purpose | Status | Evidence |
|---|---|---|---|---|---|---|
| MACH-01 | Machines | Register | Add machine | Bring an excavator into the system | Implemented | D01 F1 · B |
| MACH-02 | Machines | Register | Edit machine (not meters or status) | Correct identity and interval | Implemented (no snapshot on bills) | D01 F2 · B |
| MACH-03 | Machines | Register | "Delete" = archive machine | Retire a machine | Partial (no checks, no restore, not enforced) | D01 F3 · B |
| MACH-04 | Machines | List | Reorder machines | Display order | Implemented | D01 F4 · B |
| MACH-05 | Machines | List | View machine list (site, operator, meter, service due) | Fleet overview | Implemented | D01 F5 · B |
| MACH-06 | Machines | Detail | View machine detail (Work / History / Service / Details tabs) | Machine record | Implemented | D01 F6 · B |
| MACH-07 | Machines | Detail | Idle alert (≥ 7 days idle) | Utilisation prompt | Implemented | D01 F6, C6 · B |
| MACH-08 | Machines | Operator | Assign / change operator | Pair operator with machine | Implemented (no backdating; history not shown) | D01 F8 · B |
| MACH-09 | Machines | Site | Set / change machine's current site (+ old site status) | Track location | Implemented | D01 F9 · B |
| MACH-10 | Machines | Operator | End operator assignment | Unpair | Implemented | D01 F8 · B |
| MACH-11 | Machines | Performance | Machine Performance (earnings and hours by period) | Per-machine revenue | Partial (no costs; Direct bills incl. GST) | D01 F13 · B |
| MACH-12 | Machines | History | Work history with filters (customer, operator, site, dates) | Job history | Implemented | D01 F15 · B |
| MACH-13 | Machines | Status | "Under Service" status | Availability | Disconnected (never set) | D01 F7 · B |

## Work, hour meter and approvals

| Feature ID | Module | Submodule | Individual action | Purpose | Status | Evidence |
|---|---|---|---|---|---|---|
| WORK-01 | Work | Job | Owner Start Work (customer, site, date, meter, tool) | Begin a job | Implemented (no meter continuity) | D02 F1 · B |
| WORK-02 | Work | Job | Owner Stop Work (end date, meter, diesel, tank) | Complete a job | Implemented | D02 F2 · B |
| WORK-03 | Work | Reading | Owner Add Daily Log (meter or clock, break, operator name, diesel, tool) | Record a day's work | Implemented | D02 F3 · B |
| WORK-04 | Work | Reading | Owner edit reading | Correct a day | Partial (erases tank level; allowed after billing) | D02 F7 · B |
| WORK-05 | Work | Reading | Owner delete reading | Remove a day | Implemented (allowed after billing) | D02 F8 · B |
| WORK-06 | Work | Job | Owner edit job (customer, operator, site, dates, meters, hours, diesel) | Correct a job | Partial (no billed lock; diesel overwrite) | D02 F9 · B |
| WORK-07 | Approvals | Reading | Approve operator reading / diesel entry | Accept operator data | Implemented | D02 F6 · B |
| WORK-08 | Approvals | Reading | Reject operator reading | Refuse operator data | Partial (no reason) | D02 F6 · B |
| WORK-09 | Work | Job | Delete job (refused if billed) | Remove a job | Implemented | D02 F10 · B |
| WORK-10 | Approvals | Queue | Approvals page (readings, operator jobs, join requests, auto-refresh) | Review queue | Implemented | D02 F17 · B |
| WORK-11 | Approvals | Operator job | Reject operator job with note | Send back | Implemented (machine stays Working) | D02 F15 · B |
| WORK-12 | Approvals | Operator job | Approve operator job (pick/create customer, confirm site, meters, dates, tool, diesel) | Convert into billable job | Partial (overwrites machine status and meter unconditionally) | D02 F14 · B |
| WORK-13 | Approvals | Operator job | Cancel an in-progress operator job | — | **Not located** | D02 F15 · B |

## Operator portal

| Feature ID | Module | Submodule | Individual action | Purpose | Status | Evidence |
|---|---|---|---|---|---|---|
| PORT-01 | Operator portal | Reading | Submit reading on owner-started job | Operator records the day | Implemented | D02 F4 · B |
| PORT-02 | Operator portal | Diesel | Diesel only entry | Record a fill | Partial (may attach to an old or billed job) | D02 F5 · B |
| PORT-03 | Operator portal | Home | Portal home (machine, job, readings, 31-day history) | Operator view | Implemented | D02 F16 · B |
| PORT-04 | Operator portal | Own job | Start Work (operator job) | Operator-started job | Implemented (moves machine meter before approval) | D02 F11 · B |
| PORT-05 | Operator portal | Own job | End Work / resubmit after rejection | Submit for approval | Implemented | D02 F12 · B |
| PORT-06 | Operator portal | Own job | Edit own job while in progress or pending | Correct before approval | Implemented | D02 F13 · B |
| PORT-07 | Operator portal | Language | Choose own language (en / hi / mr) | Usability | Implemented | D03 F14 · B |

## Diesel

| Feature ID | Module | Submodule | Individual action | Purpose | Status | Evidence |
|---|---|---|---|---|---|---|
| DSL-01 | Diesel | Checker | Diesel Checker calculator | Quick average and hours-left estimate | Implemented (not saved) | D02 F19 · B |
| DSL-02 | Diesel | Purchase / stock / supplier | — | Fuel ledger | **Not located** | D02 G6 · B |

## Maintenance

| Feature ID | Module | Submodule | Individual action | Purpose | Status | Evidence |
|---|---|---|---|---|---|---|
| SVC-01 | Maintenance | Service | Add service record (date, meter, components, action, cost, brand, notes) | Record maintenance | Implemented (no edit or delete) | D01 F11 · B |
| SVC-02 | Maintenance | Catalogue | Add custom component | Extend catalogue | Partial (no interval) | D01 F12 · B |
| SVC-03 | Maintenance | View | Service tab (next due, needs attention, component status, history, replacements) | Maintenance overview | Partial ("component status" uses latest record only) | D01 F12 · B |
| SVC-04 | Maintenance | View | Component history page | Per-part history | Implemented | D01 F12 · B |
| SVC-05 | Maintenance | Alerts | Service due / overdue alerts | Prompt servicing | Implemented | D01 C1 · B |
| SVC-06 | Maintenance | Alerts | Component predictive alerts | Prompt part service | Partial (never-serviced parts never alert) | D01 C3 · B |
| SVC-07 | Maintenance | Service | Edit or delete a service record | — | **Not located** | D01 F11 · B |

## Expenses

| Feature ID | Module | Submodule | Individual action | Purpose | Status | Evidence |
|---|---|---|---|---|---|---|
| EXP-01 | Expenses | Entry | Add expense (machine, date, type, amount, notes) | Record spending | Implemented | D01 F14 · B |
| EXP-02 | Expenses | Entry | Delete expense | Remove | Implemented | D01 F14 · B |
| EXP-03 | Expenses | List | View latest 200 expenses + total | Review | Partial (no filters in screen) | D01 F14 · B |
| EXP-04 | Expenses | Entry | Edit expense | — | **Not located** | D01 F14 · B |

## Operators and salary

| Feature ID | Module | Submodule | Individual action | Purpose | Status | Evidence |
|---|---|---|---|---|---|---|
| OPS-01 | Operators | Register | Add operator (name, mobile, address, joining date, monthly salary) | Onboard | Implemented | D03 F1 · B |
| OPS-02 | Operators | Register | Edit operator (salary change rewrites the current session) | Correct | Partial | D03 F2 · B |
| OPS-03 | Operators | Register | "Delete" = archive operator | Remove | Partial (no balance check, no restore) | D03 F3 · B |
| OPS-04 | Operators | Portal access | Enable / disable portal, set / reset PIN | Give portal access | Implemented | D03 F4 · B |
| OPS-05 | Operators | Join | Operator self-signup with business code | Self-onboarding | Implemented | D03 F5 · B |
| OPS-06 | Operators | Join | Approve (with 6-digit code) / decline join request | Control onboarding | Implemented (approved operator starts at salary 0) | D03 F6 · B |
| OPS-07 | Operators | Sessions | Start New Session (close old, gap leave, carry forward) | Break and rejoin | Implemented | D03 F7 · B |
| OPS-08 | Operators | Sessions | Close session | Stop salary accrual | Implemented | D03 F8 · B |
| OPS-09 | Operators | Leave | Add / delete leave (paid or unpaid) | Record absence | Implemented | D03 F9 · B |
| OPS-10 | Operators | Money | Add transaction (category, amount, date, deduct?, effect) | Advance, expense, payment, bonus | Implemented | D03 F10 · B |
| OPS-11 | Operators | Money | Edit transaction | Correct | Implemented (no lock) | D03 F10 · B |
| OPS-12 | Operators | Money | Delete transaction | Remove | Implemented | D03 F10 · B |
| OPS-13 | Operators | Salary | Salary views (Overview, Salary month tab, Sessions, list Due/Overpaid) | Know what is owed | Partial (three formulas disagree) | D03 F11 · B |
| OPS-14 | Operators | Ranking | 45-day hours ranking | Performance glance | Implemented | D03 F13 · B |
| OPS-15 | Operators | History | History tab (last 20 completed jobs) | Job history | Implemented | D03 F12 · B |
| OPS-16 | Operators | Attendance / overtime / payslip | — | — | **Not located** | D03 §5 · B |

## Customers

| Feature ID | Module | Submodule | Individual action | Purpose | Status | Evidence |
|---|---|---|---|---|---|---|
| CUST-01 | Customers | Register | Add customer (also inline from Start Work, Direct Bill, approval) | Onboard | Implemented | D05 F1 · B |
| CUST-02 | Customers | List | List / search / trip-date filter with totals | Overview | Implemented | D05 F2 · B |
| CUST-03 | Customers | Register | Edit customer | Correct | Implemented (changes old bills) | D05 F3 · B |
| CUST-04 | Customers | Register | Archive ("delete") customer | Remove | Partial (no outstanding check, no restore) | D05 F4 · B |
| CUST-05 | Customers | Detail | Customer detail (totals, unbilled work by site, machine history, edit jobs and readings) | Account view | Implemented | D05 F5 · B |
| CUST-06 | Customers | Reminder | WhatsApp payment reminder | Collect money | Partial (amount includes un-invoiced work) | D05 F6 · B |

## Sites

| Feature ID | Module | Submodule | Individual action | Purpose | Status | Evidence |
|---|---|---|---|---|---|---|
| SITE-01 | Sites | Register | Create site (name, type, customer, location, status, rates) | Define a work place | Implemented | D05 F7 · B |
| SITE-02 | Sites | Register | Edit site / change status | Maintain | Partial (status blocks nothing) | D05 F8 · B |
| SITE-03 | Sites | Rates | Change rates with effective date | Price work | Implemented (no correction of history) | D05 F9 · B |
| SITE-04 | Sites | Register | Auto-create site by typed name | Convenience | Implemented (no customer, no rate) | D05 F7 · B |

## Billing and payments

| Feature ID | Module | Submodule | Individual action | Purpose | Status | Evidence |
|---|---|---|---|---|---|---|
| BILL-01 | Billing | Create | Generate Bill from completed jobs | Invoice logged work | Implemented | D04 F1 · B |
| BILL-02 | Billing | Create | Direct bill (one machine, bucket/breaker hours) | Invoice hire directly | Disconnected (does not mark work billed) | D04 F2 · B |
| BILL-03 | Billing | Create | Summary bill (typed lines, quick fill) | Free-form invoice | Disconnected (does not mark work billed) | D04 F3 · B |
| BILL-04 | Billing | Maintain | Edit bill (any field, any time) | Correct | Partial (no lock; letterhead re-stamped) | D04 F9 · B |
| BILL-05 | Billing | Maintain | Delete bill (with payments) | Remove | Partial (no cancel or credit note) | D04 F10 · B |
| BILL-06 | Billing | Output | View / print bill | Issue invoice | Implemented | D04 F7 · B |
| BILL-07 | Billing | Output | Share bill PDF on WhatsApp | Send invoice | Implemented | D04 F7 · B |
| BILL-08 | Billing | Output | Per-bill Excel download | Send / keep invoice | Partial (Standard layout only) | D04 F7 · B |
| BILL-09 | Billing | List | Bills list, search, App / Self filter | Find invoices | Partial (no date or status filter) | D04 F8 · B |
| BILL-10 | Billing | Export | Bills register Excel | Bookkeeping | Implemented | D04 F8 · B |
| BILL-11 | Billing | Template | Choose bill template (Standard / Daily Summary, business-wide) | Layout | Implemented (applies to old bills too) | D04 F6 · B |
| BILL-12 | Billing | Numbering | Automatic Non-GST numbers / manual GST numbers | Invoice series | Partial (no GST series) | D04 F5 · B |
| BILL-13 | Billing | Cancel / credit note / IGST / TDS | — | — | **Not located** | D04 §6 · B |
| PAY-01 | Payments | Entry | Add payment ("Give Money") | Record receipt | Implemented | D04 F11 · B |
| PAY-02 | Payments | Entry | Edit payment | Correct | Implemented | D04 F11 · B |
| PAY-03 | Payments | Entry | Delete payment | Remove | Implemented | D04 F11 · B |
| PAY-04 | Payments | Advance / unallocated / multi-bill receipt | — | — | **Not located** | D04 F11 · B |

## Reports

| Feature ID | Module | Submodule | Individual action | Purpose | Status | Evidence |
|---|---|---|---|---|---|---|
| RPT-01 | Reports | Site Analysis | Site list with totals | Site performance | Implemented | D05 F10 · B |
| RPT-02 | Reports | Site Analysis | Site detail (work type, diesel, machines, daily readings) | Site deep dive | Implemented | D05 F11 · B |
| RPT-03 | Reports | Site Analysis | Machine-at-site drill-down | Machine at site | Implemented | D05 F11 · B |
| RPT-04 | Reports | Site Analysis | Machines by site | Fleet location | Implemented | D05 R6 · B |
| RPT-05 | Reports | Dashboard | Dashboard cards with range presets | Business snapshot | Implemented | D05 F13 · B |
| RPT-06 | Reports | Dashboard | Business Profit Overview + Detail | Profit estimate | Partial (see GAP-001/005/006) | D05 C12 · B |
| RPT-07 | Reports | Dashboard | Payment Collection Status | Collection view | Implemented ("Overdue" = nothing paid) | D05 R15 · B |
| RPT-08 | Reports | Dashboard | Revenue – last 6 months | Trend | Implemented | D05 R16 · B |
| RPT-09 | Reports | Dashboard | Working hours – last 6 months | Trend | Partial (includes unapproved readings) | D05 R17 · B |
| RPT-10 | Reports | Dashboard | Hours detail per machine | Hours split | Implemented | D05 R13 · B |
| RPT-11 | Reports | Dashboard | Top Customers | Ranking | Implemented | D05 R18 · B |
| RPT-12 | Reports | Dashboard | Recent Activity | Activity feed | Implemented | D05 R21 · B |
| RPT-13 | Reports | Alerts | Notification bell / alert banner | Attention list | Implemented | D05 F14 · B |
| RPT-14 | Reports | Dashboard | Overdue Payments (15-day) widget | Chase late payers | Not shown | D05 R19 · B |
| RPT-15 | Reports | Dashboard | Operator Performance widget | Operator activity | Not shown | D05 R20 · B |
| RPT-16 | Reports | Site Analysis | Share site report PDF | Send to customer | Implemented (no daily readings) | D05 F12 · B |
| SRCH-01 | Search | Global | Search machines, customers, operators, bill numbers | Find records | Partial (no sites or amounts) | D05 F15 · B |

## Settings

| Feature ID | Module | Submodule | Individual action | Purpose | Status | Evidence |
|---|---|---|---|---|---|---|
| SET-01 | Settings | Profile | Business profile (name, owner, phone, address, GSTIN, service interval, alert threshold) | Business identity and maintenance defaults | Implemented | D05 F16 · B |
| SET-02 | Settings | Letterhead | Logos, signature, tagline, accent colour | Bill appearance | Implemented | D05 F16 · B |
| SET-03 | Settings | Bank | Add bank account, set GST / Non-GST default | Payment details on bills | Implemented | D05 F16 · B |
| SET-04 | Settings | Bank | Delete (archive) bank account | Retire account | Implemented | D05 F16 · B |
| SET-05 | Settings | Bank | Edit bank account | — | Disconnected (API only) | D05 F16 · B |
| SET-06 | Settings | Operators | Operator portal default language | Usability | Implemented | D05 F16 · B |
| SET-07 | Settings | Operators | Regenerate / customise business code | Control joins | Implemented | D05 F16 · B |
| SET-08 | Settings | Security | App lock PIN on / change / off | Device lock | Implemented | D05 F16 · B |
| SET-09 | Settings | Security | Change password | Security | Implemented | D05 F16 · B |
| SET-10 | Settings | Security | Sign out everywhere | Security | Implemented | D05 F16 · B |
| SET-11 | Settings | Appearance | Theme (light / dark) | Usability | Implemented | D05 F16 · C |
| SET-12 | Settings | Diesel | Diesel price per litre (profit costing only) | Cost diesel | Implemented | D05 F16 · B |

## Support console

| Feature ID | Module | Submodule | Individual action | Purpose | Status | Evidence |
|---|---|---|---|---|---|---|
| SUP-01 | Support console | Access | Support login (shared password, 1-hour session) | Platform support | Implemented | D05 F17 · B |
| SUP-02 | Support console | Businesses | List all businesses with counts | Oversight | Implemented | D05 F17 · B |
| SUP-03 | Support console | Businesses | Sign in as business owner (audited) | Assist customer | Implemented | D05 F17 · B |
| SUP-04 | Support console | Businesses | Freeze / unfreeze business | Suspend account | Implemented | D05 F17 · B |
| SUP-05 | Support console | Businesses | Set max operators / max bills per day | Plan limits | Implemented | D05 F17 · B |
| SUP-06 | Support console | Businesses | Clear business data | Reset account | Implemented | D05 F17 · B |

## System

| Feature ID | Module | Submodule | Individual action | Purpose | Status | Evidence |
|---|---|---|---|---|---|---|
| SYS-01 | App | Android | In-app update prompt (Android) | Keep app current | Implemented (outside functional scope; see `docs/operations.md`) | README · C |

**Total:** 131 registered rows, counted from the tables above.

| Status | Count |
|---|---|
| Implemented (including implemented with a noted caveat) | 93 |
| Partial | 25 |
| Disconnected | 4 |
| Not shown | 2 |
| Not located (listed for completeness) | 7 |
