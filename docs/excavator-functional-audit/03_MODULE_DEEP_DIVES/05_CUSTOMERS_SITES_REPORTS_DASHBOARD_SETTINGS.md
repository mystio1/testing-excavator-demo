# Module deep dive — Customers, Sites & Rates, Site Analysis, Dashboard & Profit, Search, Settings, Roles & Support Console

**Modules covered:**
- Customers (`/customers`)
- Sites and effective-dated rates (created from `/site-analysis`, or automatically by name)
- Site Analysis reports (`/site-analysis`, detail page, machine drill-down, shareable PDF)
- Dashboard (`/dashboard`) including Business Profit Overview, and the alerts bell
- Global search (`/search`)
- Settings (`/settings`)
- User roles, and the Support console (`/support`)

## Module summary (business outcome)

**Customers** are the people or companies work is done for.

**Sites** are named places of work, each with:
- an optional owning customer;
- a status label (Ongoing, Partially Completed, Completed, Deactive);
- effective-dated hourly rates for Bucket and Breaker work.

**Pricing unbilled work.** Site rates give approved work a money value even before it is billed. That value is what Site Analysis, the customer "Total / Pending" figures and the dashboard profit use.

**Reports:**
- **Dashboard:** what was invoiced and collected in a period, all-time totals, and a profit estimate (value of work done minus recorded costs).
- **Site Analysis:** hours, diesel and money by site, machine and day.

**Settings** control the bill letterhead, bank accounts, service intervals, the diesel price used for costing, and the operator portal language.

**Support console.** A shared-password support console can sign in as any business, freeze it, set limits or wipe its data.

## Reconciliation notes (main investigator)

| Claim | Verified how | Result |
|---|---|---|
| Overdue Payments and Operator Performance widgets are not displayed | grep for component names across `src/app` and `src/components` returns only their own files | **Confirmed** |
| Profit Overview formula | `dashboard.ts getProfitOverview` L879-1016 read in full | **Confirmed** (see 05_BUSINESS_RULES_AND_CALCULATIONS.md R-PROFIT) |
| `salaryCostForRange` caps at today | `dashboard.ts` L1030-1032 | **Confirmed.** When no range is passed (older Android clients), `salaryCostForMonth` charges the full current month (L929) |
| Customer pending includes unbilled work | `customers.ts` L277-280 | **Confirmed** |

> **How to read this deep dive.** Each feature (F-number) follows the Part 5 deconstruction standard in compressed form:
> *Who / Entry point* = 5.1–5.2 · *Field table* = 5.3 · *Behaviour / Checks* = 5.4 · *Calculations register* = 5.5 · *Connected modules* = 5.6 · *Status tables* = 5.7 · *Historical impact* = 5.8 · *Limitations / Gaps* = 5.10.
> Business outcome (5.9) is stated in the module summary at the top.
> Evidence grades: **A** runtime-verified (none in this audit — no application was run), **B** traced end to end through the code, **C** partly traced, **D** inferred, **E** unverified.
> Paths are relative to `excavator-manager/`. Function names are the authoritative reference; line numbers are as read on 2026-11-24 and may drift.

Short names used throughout: `cust.ts` = src/lib/services/customers.ts, `sites.ts` = src/lib/services/sites.ts, `SA.ts` = src/lib/services/siteAnalysis.ts, `dash.ts` = src/lib/services/dashboard.ts, `fin.ts` = src/lib/services/financials.ts, `set.ts` = src/lib/services/settings.ts, `sup.ts` = src/lib/services/support.ts.

---

## 1. Feature list

### F1. Customer — create
- **Who**: business owner (session role OWNER) or support while impersonating (audit actor SUPPORT). src/lib/api-auth.ts `requireBusinessApi` L29-50.
- **Entry point**: Customers page "Add Customer" button, then `/customers/new` (src/app/(app)/customers/new/add-customer-form.tsx L16-21). Calls POST `/api/customers` (src/app/api/customers/route.ts L37-56). After saving, the app goes to the customer detail page.
- **Prerequisites**: none.
- **Fields** (src/lib/validation/customer.ts `addCustomerSchema` L3-9; `cust.ts createCustomer` L135-162):

| Field | Required | Meaning | Validation | Default / business impact |
|---|---|---|---|---|
| name | Yes | Customer / contact name | trim, 1-200 ("Enter customer name", "Customer name is too long") | Printed on bills, read live from this record (see F3) |
| mobile | Yes | Phone number | trim, 6-30 chars ("Enter a valid mobile number"). Any characters are accepted, not just digits | Used by the WhatsApp button; printed on bills when `showCustomerPhone` is on |
| companyName | No | Company | max 200 | "" becomes null. Searchable |
| address | No | Address | max 500 | "" becomes null. Printed on bills, read live |
| gstNumber | No | Customer GSTIN | max 30. There is **no GSTIN format check** | "" becomes null. Offered in pickers (`listCustomerOptions` L171-178). The bill keeps its own copy in `buyerGstin` |

- **Behaviour**: creates a Customer row and writes an audit entry `customer.create` (L142-159). The route honours an `Idempotency-Key`, so a retried request replays the first result (route L43-55).
- **Duplicate check**: **none**. The route's own comment says two people can genuinely share a phone number (route L30-35). No duplicate check on name or mobile either. [B]
- **Limitations**: there is no customer-type field, credit limit, or opening balance (schema `Customer`, prisma/schema.prisma L296-316).

### F2. Customer — list
- **Entry point**: `/customers` (src/app/(app)/customers/page.tsx), GET `/api/customers?q=&tripDate=&limit=&cursor=` (route L12-24). The page loads 50 at a time with "Load more" (page L26, L64-80).
- **Filters**: `q` matches name or company (case-insensitive) or mobile (contains). `tripDate` matches customers with a work session whose `startDate` falls on that day. Archived customers are always excluded (`cust.ts customerListWhere` L14-31).
- **Each row** (L80-93): name, company, mobile, `tripCount` (count of all work sessions, L67), `totalRevenue` and `pending`, plus a WhatsApp button and a delete (archive) button (page L142-165).
- **Summary cards** (computed over the whole filtered list, first page only; L98-133): Total Customers, With Pending Dues (customers owing more than 0.01), Total Revenue, Pending Payments (page L96-111).
- **Formulas**: see C1/C2.

### F3. Customer — edit
- **Entry point**: Customer detail, "Edit" button, then `/customers/detail/edit` (edit-customer-form.tsx L34-36), PATCH `/api/customers/[id]` (route L11-20).
- **Fields**: same as F1, plus `expectedVersion` (validation L15-17).
- **Behaviour**: takes a row lock on the customer (`lockCustomer` L182-184). Returns NOT_FOUND "Customer not found". If the version is stale it returns `resourceModified("customer")` (409 RESOURCE_MODIFIED). Otherwise it overwrites all 5 fields, bumps `version`, and writes audit `customer.update` with before and after values (L192-227).
- **Historical impact**: no snapshot is taken when a customer is edited. Bills print the customer's **name, address and mobile from the live Customer row**: `toBillPreviewData` reads `bill.customer.name / address / mobile` (src/lib/services/bills.ts L1099-1102), and `getBillDetail` includes the live `customer: true` (L1078-1079). So **editing a customer changes how every old bill displays, prints and exports**. Only these fields are frozen per bill: `buyerGstin`, the letterhead (business details and bank account), and `BillItem.siteName` (schema L728-733, L760-764, L795). Work sessions point at the customer by id, so they always show the current name. [B]

### F4. Customer — archive ("Delete customer" / "Remove")
- **Entry point**: the trash button on a list row (archive-customer-button.tsx L66-79), or Delete on the edit form (edit-customer-form.tsx L45). The dialog says "This hides them from your customer list. Their past work and bills are kept for records." DELETE `/api/customers/[id]` (route L23-31).
- **Behaviour**: sets `isArchived=true` and bumps `version`, with audit `customer.archive`. Archiving an already-archived customer succeeds and does nothing (L231-258). **There is no check for outstanding money, open bills or active work** before archiving. [B]
- **Effects**:
  - New work cannot be started for an archived customer ("This customer was removed. Choose another customer.", src/lib/services/workSessions.ts L193-196). The same rule applies to operator-request approval (operatorWorkRequests.ts L405-407), new normal, summary and direct bills (bills.ts L44-47, L563-564, L681-683), and re-pointing a bill to that customer (L775).
  - Payments on the archived customer's existing bills are still allowed: `addPayment` has no archived check (bills.ts L1160-1212). [C]
  - The customer disappears from the customers list, its summary totals, search (`search.ts` L35) and pickers (`listCustomerOptions` L173).
  - The customer still counts in dashboard all-time totals, Payment Collection and Top Customers, which group bills with no archived filter (`dash.ts` L454, L747, L851).
  - The detail page still opens, because `getCustomerDetail` has no archived filter (L268-271).
  - **There is no un-archive / restore action** (bills.ts L45-46 comment). [B]

### F5. Customer — detail
- **Entry point**: `/customers/detail?id=` (page.tsx), GET `/api/customers/detail?id=&excavatorId=&site=&from=&to=` (route L7-29, `customerDetailQuerySchema` validation L48-55).
- **Shows**:
  - Header card with company, mobile, address, GST, a "₹X Total" pill and a "₹Y Pending" pill (page L184-198).
  - Cards: Machines Used, Working Days, Total Hours (L184-186). These always cover the customer's **full history**; only the list below is filtered (cust.ts L313-331).
  - "Work Not Billed Yet — Site Wise" card: hours × rate per site and work type, a "Billed X + Not billed Y" line, and a warning when a rate is missing (page L189-190, L261-320).
  - Machine History list of work sessions (`WorkCard` L31-106). Each card has machine, site, dates, operator, hours, attachment, start/end meter, diesel, status, Billed Yes/No, notes, and its daily readings (with status shown when not APPROVED). Sessions and readings can be edited and readings deleted from here.
  - Filters: machine, site name, from/to on session `startDate` (L325-331).
  - "View & Print Bill" button, which goes to `/bills?customerId=` (L151-153).
- **Sites**: the page does **not** list the sites linked to the customer (`Site.customerId`). Sites appear only as session site names and in the unbilled site-wise breakdown. [B]
- **Formulas**: C3, C4.

### F6. WhatsApp reminder button (customer list)
- whatsapp-button.tsx L7-36. Takes the digits of the mobile number; if there are exactly 10 digits it prefixes 91. If `pending` > 0.01 the message is "Hi {name}, this is a reminder that you have a pending payment of ₹{pending}. Thank you!", otherwise "Hi {name}!". It opens `wa.me` (a same-window redirect in the native Android app).
- `pending` is the list-row pending (C2), so it **includes unbilled work valued at site rates**: the reminder can quote money that was never invoiced. [B]

### F7. Site — create
- **Who**: owner. **Entry**: Site Analysis page, "Create Site" dialog (create-site-dialog.tsx L30-46), POST `/api/sites` (route L17-24).
- **Implicit creation**: a site is also created automatically by name whenever work is started, a machine's site is set, or an operator request is approved with a new site name (`findOrCreateSite` sites.ts L27-34, used by workSessions.ts L212/L943 and excavators.ts L268; a separate copy exists in operatorWorkRequests.ts L44-47). An auto-created site gets the schema defaults: type CUSTOMER_SITE, status ACTIVE, **no customer, no rates** (schema L251-258).
- **Fields** (`createSiteSchema` validation/site.ts L41-55; `createSite` sites.ts L58-94):

| Field | Required | Meaning | Validation | Default / impact |
|---|---|---|---|---|
| name | Yes | Site name | trim 1-200. Must be unique within the business, compared case-insensitively after trimming ("A site with this name already exists", CONFLICT, `assertNameFree` L51-56) | Matched by name when work is started |
| type | No | CUSTOMER_SITE / SELF_SITE | enum | Default CUSTOMER_SITE. A SELF_SITE forces `customerId=null` (L60, L74) |
| customerId | Required if CUSTOMER_SITE | Owning customer | refine: "Choose the customer for this site". The customer must exist in this business ("Customer not found"). **The customer's archived flag is not checked** (L45-49) | Shown as the site's customer. **Does not decide** which customer a job's work is attributed to (see S3) |
| address | No | Location | max 500 ("Location is too long") | — |
| status | No | ACTIVE / PARTIAL / COMPLETED / ON_HOLD | enum | Default ACTIVE. Labels: Ongoing, Partially Completed, Completed, Deactive (validation L6-13) |
| bucketRate | No | ₹ per hour for Bucket work | number 0 – 99,999,999 ("Rate cannot be negative") | If any rate is given, a SiteRateHistory row is written with effectiveFrom **1970-01-01** (L80-90) |
| breakerRate | No | ₹ per hour for Breaker ("Brekar") work | same | same |

- Audit entry `site.create` (L91).

### F8. Site — edit basics and status
- **Entry**: site detail page, `EditSiteDialog` (site-forms.tsx L119-160), PATCH `/api/sites/[id]` (route L22-30). Editable: name, type, customer, location, status, plus `expectedVersion`.
- **Behaviour** (`updateSite` L98-136):
  - row lock, NOT_FOUND "Site not found", stale version returns RESOURCE_MODIFIED;
  - changing the type to SELF_SITE clears the customer;
  - a new customer must exist ("Customer not found");
  - a new name must be free (CONFLICT);
  - `version` is bumped and audit `site.update` written.
  - Rates cannot be changed here (L96-97).
- **Status changes — what sets them**:
  1. Owner, from this dialog.
  2. Owner, when moving a machine to another site from the Machine page Site card. The `previousSiteStatus` sent with the move sets the **old** site's status in the same transaction, with audit details "machine moved to another site" (excavators.ts `setExcavatorSite` L256-310; site-card.tsx L51, L178).
  3. Nothing else changes site status automatically. No code path changes it on job stop, on billing, or on operator-request approval (approval sets `Excavator.currentSiteId` but never `Site.status`, operatorWorkRequests.ts L463). [B]
- **Effect of status**: informational only. It drives the list filter (SA.ts L714), the badge (shared.tsx L177-187), the grouping in the machine Site picker (site-card.tsx L46, L215-220), and the `activeSites` count (SA.ts L851, returned by the API but not shown on the web dashboard). **A COMPLETED or ON_HOLD site blocks nothing**: `startWork` resolves the site by name with no status check (workSessions.ts L212), and readings and bills have no site-status checks either. [B]
- **There is no site delete or archive** endpoint (routes listed in docs/authorization-matrix.md L121-129). [B]

### F9. Site rates — effective-dated change
- **Entry**: site detail page, `RatesCard` (site-forms.tsx L20-95) with fields Bucket Rate (₹/hour), Brekar / Breaker Rate (₹/hour), and "Effective from" (date, default today, required). The UI text says "Work done before this date keeps the old rate, and existing bills are not changed." PATCH `/api/sites/[id]/rates` (route L11-19).
- **Validation** (validation/site.ts L69-75): both rates are nullable numbers 0–99,999,999 (a blank field sends null, which means "no rate" from that date). `effectiveFrom` is optional, as YYYY-MM-DD.
- **Behaviour** (`updateSiteRates` sites.ts L144-193):
  - row lock and version check;
  - `effectiveFrom` defaults to today (UTC);
  - if `effectiveFrom` is later than today+1 day: BAD_REQUEST "The new rates cannot start in the future";
  - **always appends** a SiteRateHistory row. Rows are never edited or deleted, and there is no UI to fix a wrong row;
  - sets `Site.bucketRate / breakerRate` to the row in force at the cutoff (today+1 day): latest `effectiveFrom`, newest `createdAt` on ties (L169-172);
  - audit `site.rates` with the effective date.
- **Rule for which rate applies to a work day**: see C7. Bills are never re-priced, because a billed session is valued from its `BillItem.amount` (SA.ts L26-29, L187).
- **Rate history display**: the 10 most recent rows (SA.ts L912-916). Shown only when there is more than one row; the 1970 row is labelled "From the start" (detail/page.tsx L121-135).

### F10. Site Analysis — list page `/site-analysis`
- **API**: GET `/api/sites?q=&type=&status=&excavatorId=&from=&to=&page=&pageSize=` (route L10-15; `listSites` SA.ts L740-814). Pages of 20 by default, at most 100 (validation L77-90).
- **Filters**:
  - `q`: site name, address, or customer name/company (ILIKE, escaped; L707-712);
  - type, status;
  - machine: the machine ever worked there OR it is the machine's current site (L715-720);
  - from/to: filters **work entries by work date**, not the sites themselves (L743, L759).
- **Sections**:
  - "Our machines by site" (`FleetBySite` fleet-by-site.tsx, `getFleetBySite` SA.ts L650-684);
  - cards Sites / Total Work / Revenue / Pending over the whole filtered set (page.tsx L127-144; SA.ts L765, L806-812);
  - per-site cards: status, Machines Working, Bucket Rate, Brekar Rate, Total Work, Total Revenue, Pending, Last Work (page.tsx L165-174). "Last Work" ignores the date filter (SA.ts L597-602).
- **Date chips**: All time, Today, This Week (Mon–Sun), This Month, Last Month, Custom (shared.tsx L20-46).
- `GET /api/site-analysis` (operatorWorkRequests.ts `listSiteAnalysisReadings` L531-570, plus options) returns raw COMPLETED sessions. **No web UI file references it** (grep found none); it is probably a legacy endpoint for the Android client. [D]

### F11. Site Analysis — site detail `/site-analysis/detail?id=`
- **API**: GET `/api/sites/[id]/analysis?excavatorId=&from=&to=` → `getSiteAnalysis` (SA.ts L876-981). GET `/api/sites/[id]` returns the same data unfiltered (route L11-18).
- **Sections** (detail/page.tsx):
  1. Header: customer (or "Self Site"), location, type (L73-91).
  2. **Site Summary**: rates card, Machines Working Now, Customer Total Revenue / Customer Payments / Customer Pending. The customer figures come from **bills only** across all of the customer's sites (`getCustomerBillTotals` fin.ts L340-346), with the note "not the sum of the site figures below" (L104-120). Rate history.
  3. **Filters**: machine, date range (L140-159).
  4. **Cards**: Machines, Total Working Hours, Bucket Hours, Brekar Hours, Diesel Used, Average Hours / Day, Total Revenue, Received, Pending (L162-170).
  5. **Share this analysis** (F12).
  6. **Work Type Analysis** table: Bucket / Brekar / Other with hours, rate and revenue; a Total row; Billed (invoiced) and Unbilled (at site rates) (L198-245). The Rate column shows the site's **current** rate even when the revenue was computed at historical rates (SA.ts L953-954). [B]
  7. **Diesel Analysis**: Total Diesel, Average Diesel / Day, Simple Average (Diesel ÷ Hours), Exact Average (Diesel Burned) or "Not yet", Hours per litre, and the diesel entries list (L247-305; `DieselEntriesList` readings-tables.tsx L137+, `listDieselEntries` SA.ts L1257-1296).
  8. **Machines Working at this Site** cards (per machine: Total Work, Bucket, Brekar, Diesel, Average Daily Work, Total Revenue) and a **Machine-wise Summary** table (L308-390; `aggregateByMachine` SA.ts L579-595).
  9. **Daily Machine Reading** table (`DailyReadingsTable` readings-tables.tsx L25-135, `listDailyReadings` SA.ts L1163-1255). Columns: Date, Machine, Operator, Starting Reading, Ending Reading, Total Hours, Bucket Hours, Brekar Hours, Diesel (L), Closing (L), Average (L/hr), Reading Difference. Rows are flagged when the end reading is below the start reading, or when diesel consumption comes out negative.
- **Machine drill-down** `/site-analysis/machine` (machine/page.tsx): Machine, Number, Operator, Site, Current Meter; Work Summary; Diesel Summary (incl. Latest Rate, Diesel in Tank, Can Run For = closing ÷ latest average; SA.ts L990-1006); Revenue (Bucket / Brekar / Total); Diesel Entries.

### F12. Shareable Site Report (PDF)
- share-site-report-button.tsx L25-115 and detail/site-report.tsx.
- Renders a hidden report area with these sections: Site, Overall (Total Revenue, Received, Pending), Work Type, Diesel, Machine Performance, Customer Account (site-report.tsx L52-236). This is converted to a PDF that uses the current machine and date filters.
- Sharing route: the Android app opens the native share sheet; phone browsers use `navigator.share`; desktop downloads the PDF and opens WhatsApp Web addressed to the site customer's mobile. The text message carries business, site, period, machines, total work, "Total amount" (= Revenue incl. unbilled), Received and Pending (L41-52).
- The daily readings table is **not** in the PDF (it has no section in site-report.tsx). No Excel export exists for Site Analysis. [B]

### F13. Dashboard `/dashboard`
- **API**: GET `/api/dashboard?from=&to=` (route L22-59). `from` and `to` must be given together, from ≤ to, and the range must be shorter than 5×366 days (validation/dashboard.ts L3-19). The web page **always** sends a range; the default is the current calendar month **up to the month end**, so it includes future days (page.tsx L78-80, date-range-filter.tsx L45-47). The page notes "Total & Pending are all-time" (page.tsx L126).
- **Range presets**: Today, 7D, 30D, 90D, This Month, Last Month, Financial Years (1 Apr–31 Mar), Custom (date-range-filter.tsx L69-75, L125-133).
- **Sections rendered**: AlertBanner; cards Total Customers, Revenue, Amount Received, Total Amount, Pending Amount, Hours Worked (with View Detail); Business Profit Overview (with Detail); Payment Collection Status; Revenue — Last 6 Months; Working Hours — Last 6 Months; Recent Activity; Top Customers (page.tsx L131-242). Formulas are in section 2.
- **Built but not shown**: `getOverduePayments` (dash.ts L817-846), `getOperatorPerformance` (L684-735) and the components `overdue-payments.tsx`, `operator-performance.tsx`, `collection-summary.tsx` are **not imported by any page** (grep found only their definitions). The "Overdue Payments" and "Operator Performance" widgets are therefore **not on the dashboard**. [B]

### F14. Alerts / notification bell
- `getAlerts` (dash.ts L139-227) through `/api/layout` → `NotificationBell` (count capped at "9+"). The dashboard's AlertBanner uses the same rules computed inside `getDashboardSummary` (L557-596).
- **Rules**:
  - (a) operator readings PENDING: "N operator reading(s) waiting for approval";
  - (b) operator work requests PENDING;
  - (c) every ACTIVE operator work request: "{machine} started by {operator} at {hrs} hrs";
  - (d) machine service overdue (danger) or due soon (warning), from `computeServiceStatus` using the business `defaultServiceIntervalHrs` and `maintenanceAlertThresholdHrs`;
  - (e) component alerts: for each catalog item with `defaultIntervalHours`, due = (last serviced hour, or the **current meter** if never serviced) + interval. Warn when 15 hours or fewer remain; danger when overdue. At most 8 alerts, soonest first (L50-132).
- There are no money alerts (overdue bills) in this feed. [B]

### F15. Global search
- GET `/api/search?q=&type=&limit=&cursor=` (route L1-28; `globalSearch` search.ts L87-121). `q` is at most 100 characters. Each group returns up to 8 results, and a single group can be paged.
- **Scope**:
  - Machines: name or machine number, archived excluded;
  - Customers: name, company or mobile, archived excluded;
  - Operators: name or mobile, archived excluded;
  - Bills: **bill number only** (L61-69).
- **Not searchable**: sites, payments, amounts, customer GSTIN, addresses. [B]

### F16. Settings page `/settings` (page.tsx L35-47)
Sections, in order: Theme, Business Code, App Lock, Change Password, Sign Out Everywhere, Operator Language, Business Profile, Diesel Price, Bill Letterhead, Bank Accounts, App Version. (The bill template is chosen in the Bills tab, `updateBillTemplate` set.ts L163-184.)

| Setting | Fields / validation | Business effect | Evidence |
|---|---|---|---|
| Business Profile | name (1-200), ownerName (1-200), phone (6-30), address (≤500), gstNumber (≤30, no format check), defaultServiceIntervalHrs (≥1), maintenanceAlertThresholdHrs (≥1) | Name, address and GST go into the letterhead **snapshot** on new or edited bills (bills.ts `buildLetterhead` L162, L499, L608). The two hour values drive service-due alerts and status for every machine (dash.ts L199-207). ownerName is used in the dashboard greeting. Audited with the list of changed fields | validation/settings.ts L3-11; set.ts L96-133 |
| Diesel price | dieselPricePerLitre 0–10,000 or null ("That price looks wrong") | **Only** used by Profit Overview, to cost recorded litres for a machine that has no DIESEL expense in the period (dash.ts L950-968). Not used in bills; a direct bill has its own price | validation L249-252; set.ts L187-212 |
| Bill Letterhead | left/right logo and signature (PNG/JPEG/WebP ≤300 KB, ≤2000 px, magic bytes checked, SVG refused), tagline ≤200, accent colour #RRGGBB | Snapshotted onto each bill when it is created **and again when a bill is edited** (schema L760-764) | validation L34-219; set.ts L246-277 |
| Bank Accounts | label, accountHolderName, accountNumber, ifsc (stored upper-case), bankName, branch, isDefaultForGst, isDefaultForNonGst | Setting a default flag clears that flag on every other account, with an audit entry for each (L291-328). The bill forms pre-select the default for the chosen bill type (generate-bill-form.tsx L124, generate-direct-bill-form.tsx L108, use-bill-editor.ts L81). Archive is a soft delete, and archived accounts cannot be chosen for new bills. **The settings UI offers only Add and Delete**; PATCH exists in the API but no web form calls it (bank-accounts-section.tsx L35, L64) | set.ts L279-438; route [id] L10-30 |
| Operator Language | en / hi / mr | Display language of the operator portal after login | validation L221-223; set.ts L135-160; schema L33-38 |
| Business Code | regenerate randomly, or set a custom code of 3-20 letters/numbers. Must be unique: "That business code is already taken — try another one." | The old code stops working immediately. Operators join the business with it, and support addresses the business by it. Audited | set.ts L39-82; validation L226-233 |
| App Lock PIN | 4 or 6 digits, with confirmation. Changing or disabling needs the current PIN. 5 failures per 5 minutes plus a daily cap; a correct PIN is not counted | Re-unlock gate on top of the session. **Refused during a support session** ("This action is not available in a support session.") | auth.ts L475-526; validation/auth.ts L58-74; api/settings/app-pin L21-42 |
| Change Password | current + new password (password policy) | Bumps `tokenVersion`, which signs out every device. Audit `auth.passwordChange`. Refused in a support session | auth.ts L381-419; change-password route L22 |
| Sign Out Everywhere | — | Bumps `tokenVersion`. Audit `auth.signOutEverywhere`. Refused in a support session | auth.ts L427-443 |

### F17. Support console `/support`
- **Login** (support/login route L25-47): a single shared password `SUPPORT_ACCESS_PASSWORD`. When it is not set the route returns **404**. Limited to 3 attempts per 15 minutes per IP plus a platform-wide daily cap. A successful login opens a one-hour, revocable token session.
- **Capabilities**:

| Capability | What it does | Audit |
|---|---|---|
| List businesses | Every business with counts: users, active operators, customers, machines, bills today. This is the one deliberate cross-tenant read (`listBusinessesForSupport` sup.ts L19-50) | — |
| Impersonate | Signs in as the business's oldest OWNER user (sup.ts L62-70; route L10-40). Every change is audited as actor SUPPORT (api-auth.ts L45-47). PIN, password and sign-out-everywhere are blocked | `support.impersonate` |
| Freeze / Unfreeze | Every business and operator API except `/api/layout` returns 423 ACCOUNT_FROZEN: "This account has been frozen by our support team. Your data is safe — contact support for recovery." Takes effect on the client's next layout poll (sup.ts L79-103; api-auth.ts L6-11, L34-36) | `support.freeze` / `support.unfreeze` |
| Limits | `maxOperators` and `maxBillsPerDay` (positive integers, blank = unlimited). Enforced when an operator is created ("You've reached your plan's limit of N operators. Contact support to raise it.", operators.ts L140-145) and when a normal, summary or direct bill is created (bills.ts L148-157, L446, L567, L686) | `support.setLimits` |
| Clear data | Deletes bills (cascading items and payments), work sessions (cascading readings), service records, expenses, operator work requests, assignments, machines, customers, sites, bank accounts, bill number sequences and idempotency keys. **Keeps** the business, its users, operators, operator transactions/categories, working periods, leaves and the audit log. The confirmation code must match the business code ("Confirmation code doesn't match the business code"). One transaction, no undo (sup.ts L184-236; route L16-18) | `support.clearData` with counts |

- Every support action needs a reason of 5-500 characters (validation/support.ts L7-12).

---

## 2. Report register

| # | Report / card | Question answered | Source records | Date basis | Filters | Exact formula | Grouping | Export | Reconciliation notes |
|---|---|---|---|---|---|---|---|---|---|
| R1 | Customers list cards (Total Customers, With Pending Dues, Total Revenue, Pending Payments) | How much have all customers generated, and how much is owed? | Bill (`totalAmount`, `paidAmount`); approved work entries (C6) | **None.** All-time; `tripDate` only narrows which customers are included | q, tripDate; archived excluded | Total Revenue = Σ Bill.totalAmount + Σ unbilled uv. Pending = that − Σ Bill.paidAmount. With Pending Dues = count of customers where (total − paid) > 0.01 (cust.ts L100-133) | per customer | No | Mixes amounts **with GST, net of diesel advance** (bills) and **without GST** (unbilled value). Archived customers' money is left out here but included on the dashboard |
| R2 | Customer detail Total / Pending pills | What has this customer generated and owed? | Bills of the customer + `getCustomerUnbilledWork` | All-time | none (filters only affect the list) | Total = Σtotal + Σunbilled. Pending = (Σtotal − Σpaid) + Σunbilled (cust.ts L276-280) | — | No | Differs from "Customer Total Revenue" on the Site Analysis detail page (R7c), which is bills only |
| R3 | Customer detail Machines Used / Working Days / Total Hours | How much work was done for this customer? | WorkSession (**every** status), DailyWorkLog | All-time | none | Machines = distinct machine ids. Hours = Σ session.totalHours (L316). Working days = C5 | — | No | Hours count **every session** regardless of approval. Site Analysis counts approved readings only, so the two can differ [D: depends on how `totalHours` is rolled up, which another agent covers] |
| R4 | Site Analysis list cards and per-site rows | Per site: hours worked, value, money received, money pending | Work entries (C6) + BillItem/Bill | Work entry date (log.date or session.startDate) | q, type, status, machine, from/to | Revenue = Σ revenue(entry). Received = Σ received(entry). Pending = Revenue − Received (C8-C10) | site | No | Received excludes the bill's charges and GST share (C9). Direct bills and summary-bill lines never appear |
| R5 | Machines Working (site row / detail) | Which machines are at this site now? | Excavator status WORKING + ACTIVE sessions + `currentSiteId` | now | — | WORKING, not archived machines with an ACTIVE session at the site **or** `currentSiteId` = site (SA.ts L611-636) | site | No | A machine can be counted at **two sites** (its current site and the site of its running job). The fleet card uses session site first, then current site, so each machine appears **once** (L672). The two can disagree |
| R6 | Fleet by site | Where is every machine? | Excavator, ACTIVE session | now | — | site = latest ACTIVE session's site, else `currentSite`, else "not at any site"; `working` = count with status WORKING (L650-684) | site | No | — |
| R7a | Site detail cards (Machines … Pending) | Site totals | as R4, narrowed to one site | work date | machine, from/to | `aggregateAll` + `toTotals` (SA.ts L227-272). avgHoursPerDay = hours ÷ workDays; avgDieselPerDay = diesel ÷ dataDays | — | PDF (F12) | — |
| R7b | Work Type Analysis | Bucket vs Breaker vs Other value | as R4 | work date | as R7a | revenue per wtype; Billed = Σ revenue where billed; Unbilled = Revenue − Billed | wtype | PDF | Rate column shows the **current** rate, not the rate used |
| R7c | Customer Total Revenue / Payments / Pending (site detail) | The customer's whole account | Bill aggregate for customer | all-time, all sites | none | billed = ΣtotalAmount; received = ΣpaidAmount; pending = difference (fin.ts L316-346) | — | PDF ("Customer Account") | **Excludes unbilled work**, unlike R2, yet labelled "Customer Total Revenue" |
| R7d | Diesel Analysis | Diesel use and averages | Work entries `diesel`; closing tank readings | work date (closings: all dates) | machine, from/to | Simple = diesel ÷ hours, and hours ÷ diesel (L1087-1095). Exact = (Σfilled − latest closing) ÷ hours over machines that have a closing reading (L1104-1124) | — | PDF | Diesel internals covered by another agent |
| R7e | Machine-wise summary | Per-machine site performance | as R4 | work date | as R7a | `aggregateByMachine` (L579-595); operator = latest entry's operator name | machine | PDF | — |
| R7f | Daily Machine Reading | Day-by-day meter and work check | as R4 | entry day | as R7a, paged | Total Hours = Σ(end−start) when both meters exist and end ≥ start, else hours. Bucket/Brekar/Other = recorded hours by wtype. Reading Difference = Total − (Bucket + Brekar). Average = C11 (L1163-1255) | day × machine | No | PENDING and REJECTED readings are never shown |
| R7g | Diesel entries | Each refill | entries with diesel > 0 | entry date | as R7a | totalLitres, avgPerDay, avgPerHour = diesel ÷ hours (L1257-1296) | entry | No | — |
| R8 | Dashboard "Total Customers" | How many active customers? | Customer | none | — | count where not archived (dash.ts L453) | — | No | — |
| R9 | Dashboard "Revenue" / "Monthly Revenue" | How much was invoiced in the period? | Bill | **billDate** | range | Σ Bill.totalAmount where billDate in range (L434-437, L479). Trend % vs the previous window of equal length, null if the previous value ≤ 0 (L382-385, L502) | — | No | Includes GST, is net of diesel advance, and **excludes unbilled work**. Differs from Profit "revenue" (R14) |
| R10 | Dashboard "Amount Received" | How much cash was collected in the period? | Payment | **payment date** | range | Σ Payment.amount where date in range (L473-476, L482) | — | No | — |
| R11 | Dashboard "Total Amount" | All money of work on the books | Bills + Site Analysis unbilled | **All-time** (ignores the range) | — | Σ all Bill.totalAmount + `getSiteTotals().unbilledRevenue` (L497-498) | — | No | Mixes amounts with and without GST. Self-site work at rated sites counts as revenue (S4) |
| R12 | Dashboard "Pending Amount" (links to Site Analysis) | How much is still to be collected? | as R11 − all payments | All-time | — | Total Amount − Σ all Payment.amount (L501) | — | No | **≠ Site Analysis Pending** (R4) whenever bills carry GST, charges or a diesel advance, or there are direct/summary bills. The code comment claims they agree; that holds only for the unbilled part |
| R13 | Dashboard "Hours Worked" card and its View Detail | Hours in the period | DailyWorkLog (**any status**), sessions with no logs | log.date; for no-log sessions: start **or** end date in range | range | Σ hoursWorked over logs in range (**no status filter**: PENDING and REJECTED included) + Σ totalHours of no-log sessions that start or end in range (any status) (L361-380). **Detail dialog**: per machine Σ totalHours of **COMPLETED** sessions that start or end in range, by attachment (L232-271) | machine (detail) | No | Card ≠ detail ≠ Site Analysis hours (approved only). A no-log session spanning two windows counts in both, which skews the trend %. A session that starts before the range and ends after it is missed |
| R14 | Business Profit Overview (and Detail) | Did the business make money in the period? | Work entries, BillItem, Bill, ServiceRecord, ExcavatorExpense, salary breakdown, diesel price | work date (work revenue, diesel litres); billDate (other bill lines, charges); serviceDate; expense date; salary prorated by days | range | C12 (dash.ts L897-1016) | breakdown: Operator Salary, Diesel, Maintenance, Other Expenses | No | Revenue here is **work value** (incl. unbilled), excludes GST, and adds charges − discount. It is not invoiced (R9) and not collected (R10) |
| R15 | Payment Collection Status | Which customers are paid / partly paid / unpaid? | Bill grouped by customer | **billDate in range** | range | per customer: pending = Σtotal − Σpaid. **Paid** if pending ≤ 0.01; **Partial** if paid > 0.01; otherwise **"Overdue"** (= nothing paid, **no age rule**) (L743-799). Totals Billed / Received / Pending | customer bucket | No | "Overdue" here only means "nothing paid yet". The 15-day-grace overdue rule (R19) is not used |
| R16 | Revenue — Last 6 Months chart | Billing trend | Bill | billDate, server-local month | **ignores the range** | Σ totalAmount per month for the current month and the 5 before it (L336-352) | month | No | Server timezone assumed UTC [E] |
| R17 | Working Hours — Last 6 Months chart | Hours trend | DailyWorkLog (any status), no-log sessions with totalHours > 0 | log.date; no-log sessions spread evenly across their days | ignores the range | logged Σ hoursWorked per month + session totalHours ÷ days per day (L284-334) | month | No | Includes unapproved and rejected readings |
| R18 | Top Customers | Biggest customers | Bill grouped by customer | billDate in range | range | rank by Σ totalAmount; show received and pending; top 5 (L850-877) | customer | No | Includes archived customers. Unbilled work is excluded (unlike R1) |
| R19 | (not rendered) Overdue Payment Alert | Which bills are overdue? | Bill UNPAID/PARTIAL | billDate | — | billDate ≤ now − 16 days; daysOverdue = floor((now − billDate)/day) − 15; oldest first, top 5 (L810-846) | bill | — | **Dead feature on the web dashboard** |
| R20 | (not rendered) Operator Performance | Operator activity | APPROVED logs, PENDING / REJECTED counts | current calendar month (fixed) | — | workDays = distinct log dates; totalHours; avg = hours ÷ days; pending count (all-time); rejected count (this month) (L684-735) | operator | — | **Dead feature on the web dashboard** |
| R21 | Recent Activity | What happened lately? | WorkSession created/completed, Bill created, Payment created | createdAt / updatedAt | — | merge the 20 latest of each type; newest 20 overall (L612-679) | — | No | "work-stopped" uses `updatedAt`, so **any later edit** of a completed session moves it back to the top as "finished a job" [D] |
| R22 | Alerts | What needs attention? | see F14 | now | — | F14 | — | — | — |
| R23 | Machine Earnings (Machine Performance, excavators page; same engine) | Per-machine earnings by day/week/month/year | entries + direct bills + summary-bill lines | work date; billDate for direct/summary | period | revenue per bucket = Σ entry revenue + unlinked BillItem.amount + direct-bill **totalAmount** (SA.ts L330-439) | machine × period | No | Direct bills use totalAmount (incl. GST, net of diesel advance) here, while Profit uses the direct bill **subtotal**. Inconsistent [B] |

---

## 3. Calculations register

- **C1 — Customer list row** (cust.ts L80-92): `totalRevenue = round2(ΣBill.totalAmount + unbilledUV(customer))`; `pending = round2(that − ΣBill.paidAmount)`; `tripCount = count(WorkSession for customer)`.
- **C2 — Customer list summary** (L100-133): per matching customer `total = unbilled + ΣtotalAmount`, `paid = ΣpaidAmount`. Cards: Σtotal, Σtotal − Σpaid, and count of customers with (total − paid) > 0.01.
- **C3 — Customer detail** (L276-280): `billed = ΣtotalAmount`, `billsPending = Σtotal − Σpaid`, `unbilled = Σ getCustomerUnbilledWork.amount`, `Total = billed + unbilled`, `Pending = billsPending + unbilled`.
- **C4 — Customer unbilled work per site and type** (SA.ts L475-495): over entries that are not billed, belong to this customer and have hours > 0, grouped by site and wtype. `hours = Σhours`; `amount = Σuv`; `rate` = rate of the latest-dated entry, or null if any entry in the group has `rateMissing`.
- **C5 — Working days** (cust.ts L380-405): the set of distinct UTC dates. A session with readings contributes the dates of readings that are not REJECTED and have hoursWorked null or > 0. A session with no readings contributes every day from start to end (or to today while ACTIVE; or the start day only if it is completed without an end date), capped at 3,660 days. Note that this **includes PENDING readings**.
- **C6 — Work entry** (SA.ts L97-127): every **APPROVED** DailyWorkLog (a DIESEL_ONLY log counts 0 hours and its diesel), plus every WorkSession with **no** logs at all, dated at `startDate`, with hours = totalHours. A running session (ACTIVE) with 0 hours and 0 diesel is skipped. Work type: attachment containing "bucket" → BUCKET; containing "breaker" or "brekar" → BREAKER; anything else → OTHER (L130-132).
- **C7 — Rate applied to an entry** (SA.ts L145-153, L166-174): from the site's SiteRateHistory rows, choose rows with `effectiveFrom ≤ entry date` first, taking the latest effectiveFrom. If none qualify, take the **earliest** row. On ties, the newest createdAt. If the site has no history rows at all, use the current `Site.bucketRate / breakerRate`. For a no-log session the entry date is `startDate`, so a multi-day job is priced entirely at its start-date rate [B]. A null rate on the chosen row means 0 value and sets `rateMissing` (L156-159). Consequence: the **first** rate ever saved applies backwards to all earlier work, even if it was saved "from today" [B].
- **C8 — Entry value** (L145-149, L176-190):
  - `uv = hours × rate` (0 for OTHER, or when the rate is null);
  - when billed, `share = uv ÷ Σuv(session)`; if Σuv = 0 then `hours ÷ sessionHours`; otherwise `1 ÷ entryCount`;
  - `revenue = billed ? BillItem.amount × share : uv`.
  - A session can have only one BillItem (unique `workSessionId`, schema L801-805), so entries are not duplicated.
- **C9 — Entry received** (L188; fin.ts L349): `billed ? BillItem.amount × share × (Bill.paidAmount ÷ Bill.totalAmount) : 0`; the fraction is 0 when totalAmount is 0.
- **C10 — Site totals** (L243-272):
  - Pending = Revenue − Received; Unbilled = Revenue − Billed;
  - workDays = distinct dates with hours > 0; dataDays = distinct dates with any entry;
  - avgHoursPerDay = hours ÷ workDays; avgDieselPerDay = diesel ÷ dataDays; avgDieselPerHour = diesel ÷ hours (rounded to 2 dp).
- **C11 — Daily reading diesel average** (L1050-1065): `consumed = (prevClosing ?? 0) + filled − closing`. The value is null when there is no closing reading, or when there is no previous closing and nothing was filled. If consumed < 0 the row is flagged. `average = consumed ÷ totalHours`.
- **C12 — Profit Overview** (dash.ts L897-1016):
  - `workRevenue = Σ entry revenue (C8)` for entry date in range (via `getWorkTotals`, SA.ts L553-560).
  - `otherBillLines = Σ BillItem.amount with no workSessionId on non-direct bills (billDate in range) + Σ direct-bill subtotal (billDate in range)`.
  - `charges = Σ(transport + fuel + extra + bucketCharge + breakerCharge) − Σdiscount` over **all** bills with billDate in range.
  - `REVENUE = workRevenue + otherBillLines + charges`. GST is excluded; the diesel advance is not deducted (L886-895).
  - `salary`: with a range (the web always sends one), each month's (Σ baseSalary + bonus) × overlapDays ÷ daysInMonth, **counting days only up to today** (L1030-1059). With no range (older Android builds), the full month's base + bonus (L929, L1019-1023).
  - `maintenance = Σ ServiceRecord.cost (serviceDate) + Σ ExcavatorExpense of type REPAIR / SERVICE / PARTS / TYRES (date)`.
  - `other = Σ ExcavatorExpense of type TRANSPORT / OTHER`.
  - `diesel`, per machine: if that machine has any DIESEL expense in range, the cost is their sum ("purchases"). Otherwise, if litres > 0 and a price is set, litres × dieselPricePerLitre ("litres"). Otherwise 0 ("no-price"; those litres are reported as `uncostedLitres`).
  - `EXPENSES = salary + maintenance + diesel + other`; `PROFIT = REVENUE − EXPENSES`; `margin% = PROFIT ÷ REVENUE` (1 dp; 0 if revenue ≤ 0).
  - **Not included**: OperatorTransaction (advances, payments), machine purchase or EMI, any site-level expense, GST payable.
- **C13 — Dashboard cards**: Revenue = Σ Bill.totalAmount (billDate in range); Received = Σ Payment.amount (date in range); Total Amount = Σ all Bill.totalAmount + all-time unbilled; Pending = Total Amount − Σ all payments; `pendingPayments` (not shown) = Σ(total − paid) of UNPAID/PARTIAL bills (dash.ts L483).
- **C14 — Date windows**:
  - Dashboard: `from` = `T00:00:00.000Z`, `to` = `T23:59:59.999Z` (UTC) (L24-26).
  - Site Analysis and customers: `new Date(from)` (UTC midnight) and `new Date(to + "T23:59:59.999")`, which is parsed as **server-local** time (SA.ts L86-91; cust.ts L28, L329). These agree only when the server runs on UTC [E].
  - Previous window = the same length immediately before (dash.ts L35-39).

---

## 4. Roles & permissions

| Principal | How authenticated | Can do | Cannot do | Evidence |
|---|---|---|---|---|
| OWNER (the only business user role) | email/phone + password session. Role must be OWNER and match the database (session.ts L31-34, L54) | Everything under `/api` marked "business owner": customers, sites, rates, bills, payments, settings, dashboard, search, support-free settings | — There are no staff or accountant roles; the `role` field exists for future roles (schema L120-121, L134) | docs/authorization-matrix.md L15-141 |
| OPERATOR | mobile + PIN, separate portal (`requireOperatorApi` api-auth.ts L52-65; session.ts L96) | `/api/operator/*`: daily log, diesel, home, language, layout, work start/end/edit. All of it waits for owner approval | No access to customers, sites, bills or reports | matrix L76-83 |
| SUPPORT (console token) | shared password, one-hour token | list businesses, impersonate, freeze/unfreeze, limits, clear data (reason required) | — | F17 |
| SUPPORT impersonating OWNER | real owner session that carries `supportSessionId` | everything the owner can do; audit actor shown as "Support (acting as the owner)" | set or disable app PIN, change password, sign out everywhere | api-auth.ts L45-47; app-pin route L25, L36; change-password route L22; sign-out-everywhere route L16 |
| Frozen business | — | `/api/layout` only (to show the frozen notice) | every other business and operator API (423) | api-auth.ts L29-36, L52-58 |
| Public | — | login, register, forgot/reset password, operator signup, health, app-version | — | matrix L17-28 |

---

## 5. Scenario answers

| # | Scenario | Supported? | Behaviour / records affected | Grade |
|---|---|---|---|---|
| S1 | Customer info changed | Yes (edit) | The Customer row is overwritten and audited. **Old bills show the new name, address and mobile** (read live, bills.ts L1099-1102). `buyerGstin`, letterhead and BillItem.siteName stay as they were on the bill. Changing a customer's GST number does **not** change `buyerGstin` on existing bills. Work sessions keep pointing at the same customer id. A bill already sent out as a PDF stays as it was, but a reprint will differ | B |
| S2 | Customer archived while money is still owed | Allowed, with no warning or block | `isArchived=true`. The customer leaves the customer list and its cards, search and pickers, so **the outstanding amount vanishes from the Customers screen** but stays in dashboard Total/Pending, Payment Collection and Top Customers. Payments on its existing bills are still accepted. Completed work can still be billed from the work list (bills.ts L44-46). New work and new standalone bills are blocked. There is no restore | B (payments C) |
| S3 | Multiple sites per customer | Yes. `Site.customerId` is many-to-one; any number of sites. **But** the customer a job's money is attributed to is `WorkSession.customerId`, chosen independently when work starts (workSessions.ts L193-219). A site's customer can differ from its jobs' customers, and changing a site's customer does not re-attribute old work. Site Analysis shows the **site's** customer name, while customer unbilled totals follow the **job's** customer. Auto-created sites have no customer ("—") | Supported, with an attribution gap | B |
| S4 | CUSTOMER_SITE vs SELF_SITE | A SELF_SITE has no customer (label "Self Site", SA.ts L724, L786). Jobs still **require** a customerId (schema L415). If a self site has rates set, its unbilled work is valued and counted in that job customer's Total/Pending, in the WhatsApp reminder, and in dashboard Total/Pending as if it were billable [D]. There is no special treatment of SELF_SITE in the valuation engine (no `type` condition in `entriesCte` L97-190) | Partial | B (engine) / D (business consequence) |
| S5 | Site closed (COMPLETED / ON_HOLD) | Status is label-only. **Work can still be started and logged**, readings approved and bills created at a closed site. Nothing is triggered: no notification, no final bill, no machine release | — | B |
| S6 | Machine moves between sites | Owner sets the machine's site on the Machine page: `Excavator.currentSiteId` changes, and optionally the old site's status is updated in the same step (audited). The site is auto-created if the name is new. A running job keeps its own siteId, so the move does not split the job. During that window, Machines Working counts the machine at both sites (R5). An operator-proposed move takes effect only on approval (operatorWorkRequests.ts L463) | Yes | B |
| S7 | Site-level expenses | **No site-level expenses exist.** ExcavatorExpense, ServiceRecord and salary carry no siteId (schema L677-694). Site Analysis therefore has no cost or profit view; profit exists only business-wide (R14) | Not supported | B |
| S8 | Bill totals vs dashboard totals | Dashboard Revenue = Σ Bill.totalAmount by bill date, which **equals the Bills list for the same dates** only if both use billDate [E for the Bills list filter]. Total Amount adds unbilled work. Profit revenue is a different measure (work value ex-GST plus charges). The site-level sum of Revenue equals the BillItem amounts only, without charges or GST | Risk | B |
| S9 | Revenue recorded but not collected | Shown as Pending in Site Analysis, Customers and Dashboard. Unbilled work (approved but never invoiced) is **also** counted as pending/revenue, priced at site rates, so "pending" mixes receivables with work that is not yet invoiced | Yes | B |
| S10 | Cash received but not allocated | **Impossible by design.** A Payment must belong to a Bill (`billId` required, schema L815-824) and cannot exceed the bill's remaining balance (`addPayment` bills.ts L1174-1175). There are no advances, on-account receipts or customer credit. A customer's diesel supply is netted only as `dieselAdvance` on a bill | Not supported | B |
| S11 | Expense changed after reporting | All reports are computed live, with no period close or snapshot. Editing or backdating an expense, service record, reading, rate or salary changes past Profit Overview figures immediately. A shared PDF or WhatsApp report is a point-in-time copy only. Rate changes never alter billed work (C8) but **do** change the value of unbilled work dated on or after the new effective date | Yes (live) | B |
| S12 | Dashboard vs Site Analysis inconsistencies | (a) Pending: dashboard = all bills (incl. GST) + unbilled − all payments; Site Analysis = work-linked item share − proportional receipts (R12 vs R4). (b) Hours: dashboard counts readings of any status; Site Analysis counts approved only (R13). (c) Revenue: dashboard card = invoiced by bill date; Site Analysis = work value by work date. (d) Machines Working is counted per site (with possible double counting); dashboard `machinesWorking` dedupes (SA.ts L854-858). (e) Direct and summary bills never appear in Site Analysis. (f) The "Customer Total Revenue" label on site detail means bills only, while the customer page "Total" includes unbilled | Inconsistent | B |
| S13 | Rate changed mid-job | Readings on or after the new date get the new rate. A no-log session uses its startDate rate for all its hours. The Work Type table's rate column shows only the current rate | Partial | B |
| S14 | Wrong rate entered | You cannot edit or delete a history row. The only fix is to append a corrective row with the same or an earlier effective date (on a tie the newest createdAt wins) | Workaround only | B |
| S15 | Duplicate customer | Allowed (no check) | Splits that customer's totals across two records | B |
| S16 | Duplicate site name | Blocked (case-insensitive) when creating or renaming. `findOrCreateSite` reuses the existing site | — | B |
| S17 | Support clears data | All commercial records are deleted. Operator money history is kept, so salary-based records remain while machines are gone [D: relational effects on operator views not traced] | — | B / D |

---

## 6. Gaps (functional)

1. Customer name, address and mobile are not snapshotted on bills, so historical invoices change when the customer is edited (S1).
2. No outstanding-balance warning on archive, and no restore. The outstanding amount disappears from the Customers screen (S2).
3. Job customer and site customer are independent, so attribution can disagree (S3). Auto-created sites have no customer and no rates, so their Bucket/Breaker work is valued at ₹0 until a rate is set (`rateMissing`).
4. SELF_SITE work can still be valued as a customer's receivable (S4).
5. Site status has no enforcement and no automation (S5). There is no site delete or archive.
6. Rate history is append-only with no correction UI. The first rate applies backwards (C7). No-log jobs are priced at their start date.
7. "Pending" everywhere includes unbilled work valued without GST, mixed with bill amounts that include GST. The WhatsApp reminder can demand un-invoiced money (F6).
8. Dashboard Pending ≠ Site Analysis Pending, despite the code comment (R12). Site Received ignores charges and GST.
9. Dashboard hours include PENDING and REJECTED readings, and the card, its detail dialog and the trend use three different rules (R13, R17).
10. Overdue Payments (15-day rule) and Operator Performance are implemented but **not displayed**. The "Overdue" bucket in Payment Collection means only "nothing paid" (R15, R19, R20). There is no due date or credit term on a bill.
11. No site-level or customer-level profitability, because there are no site expenses (S7). Operator advances and transactions are excluded from profit; the definition is salary accrual only.
12. Direct bills are valued at subtotal in Profit but at totalAmount in Machine Earnings (R23).
13. No exports for the dashboard, Site Analysis tables or customer statements. Only the Site Analysis PDF share exists, and it omits the daily readings. There is no customer ledger or statement.
14. No unallocated receipts, advances or credit notes (S10).
15. Search does not cover sites, and searches bills by number only (F15).
16. Bank account edit is not reachable from the settings UI (F16).
17. No GSTIN format validation for customers or the business.
18. Date windows depend on the server timezone in Site Analysis and Customers, and use explicit UTC on the Dashboard (C14) [E].
19. The default dashboard "This Month" runs to the month end, so the comparison window for the trend is a full month even mid-month (L35-39; page L78-80). Salary is capped at today, so profit stays fair, but the revenue/hours trend % compares a partial current month with a full previous one [D].

---

## 7. Evidence index

- src/lib/services/customers.ts: customerListWhere L14-31; listCustomers L50-96; getCustomerListSummary L100-133; createCustomer L135-162; listCustomerOptions L171-178; lockCustomer L182-184; updateCustomer L192-227; archiveCustomer L231-258; getCustomerDetail L267-372; countWorkingDays L380-405
- src/lib/validation/customer.ts: addCustomerSchema L3-9; updateCustomerSchema L15-17; list/detail query schemas L43-55
- src/lib/services/sites.ts: listSiteOptions L9-15; findOrCreateSite L27-34; RATES_FROM_THE_START L38; assertCustomer L45-49; assertNameFree L51-56; createSite L58-94; updateSite L98-136; updateSiteRates L144-193
- src/lib/validation/site.ts: types/statuses/labels L3-13; rate L36; createSiteSchema L41-55; updateSiteSchema L58-65; updateSiteRatesSchema L69-75; list/analysis query L81-99
- src/lib/services/siteAnalysis.ts: header rules L7-66; parseRange L86-91; entriesCte L97-191; dateCond L193-198; AGG_SELECT/toTotals L227-272; getMachineEarnings L330-439; getUnbilledByCustomer L460-472; getCustomerUnbilledWork L475-495; getRecordedHoursForBilling L516-545; getWorkTotals L553-560; getDieselLitresByMachine L563-570; aggregateByMachine L579-595; lastWorkDates L597-602; getMachinesWorkingBySite L611-636; getFleetBySite L650-684; siteFilterCond L705-722; listSites L740-814; getSiteTotals L848-870; getSiteAnalysis L876-981; getDieselConsumptionStats L990-1006; dieselEntryAverage L1050-1065; simpleDieselAverage L1087-1095; consumptionPerHour L1104-1124; closingBalances L1128-1150; listDailyReadings L1163-1255; listDieselEntries L1257-1296
- src/lib/services/financials.ts: rules L7-19; toBillTotals L26-30; sumBills L33-38; billTotalsByCustomer L41-47; getCustomerBillTotals L50-56; BILL_PAID_FRACTION_SQL L59
- src/lib/services/dashboard.ts: range helpers L19-44; getComponentMaintenanceAlerts L76-132; getAlerts L139-227; getMachineHoursDetail L232-271; getMonthlyHoursTrend L284-334; getMonthlyRevenueTrend L336-352; getHoursForSessionsOverlappingRange L361-380; percentChange L382-385; getDashboardSummary L387-599; getRecentActivity L612-679; getOperatorPerformance L684-735; getPaymentCollectionStatus L743-799; getOverduePayments L810-846; getTopCustomersByRevenue L850-877; getProfitOverview L897-1016; salaryCostForMonth L1019-1023; salaryCostForRange L1030-1059
- src/lib/validation/dashboard.ts L3-19; src/app/api/dashboard/route.ts L22-59
- src/lib/services/search.ts L17-121; src/app/api/search/route.ts L1-28
- src/lib/services/settings.ts: regenerateBusinessCode L39-82; updateBusinessProfile L96-133; updateOperatorLanguage L135-160; updateBillTemplate L163-184; updateDieselPrice L187-212; updateBillLetterhead L246-277; bank accounts L279-438
- src/lib/validation/settings.ts L3-252; src/lib/validation/auth.ts L58-74
- src/lib/services/auth.ts: changePassword L381-419; signOutEverywhere L427-443; setAppPin/disableAppPin/verifyAppPin L475-526
- src/lib/services/support.ts L19-236; src/lib/validation/support.ts L1-40; src/app/api/support/* routes; src/app/support/page.tsx L313-316, L329-580
- src/lib/api-auth.ts L6-65; src/lib/session.ts L31-34, L54, L96
- src/lib/services/excavators.ts setExcavatorSite L256-310; src/app/(app)/excavators/detail/site-card.tsx L46, L51, L178, L215-220
- src/lib/services/workSessions.ts startWork L180-235 (archived check L193-196, site by name L212)
- src/lib/services/operatorWorkRequests.ts L44-47, L405-407, L463, listSiteAnalysisReadings L531-570
- src/lib/services/bills.ts: archived rules L44-47; checkDailyBillLimit L148-157; buildLetterhead L162; normalBillTotals L274-296; getBillDetail L1075-1086; toBillPreviewData L1095-1130; addPayment L1160-1212
- src/lib/services/operators.ts L140-145 (maxOperators)
- prisma/schema.prisma: Business L19-63; User L140-151; Excavator L184-229; Site L249-276; SiteRateHistory L281-294; Customer L296-316; WorkSession L411-461; ExcavatorExpense L677-694; Bill L716-787; BillItem L789-813; Payment L815-831
- UI: src/app/(app)/customers/page.tsx L26-170; customers/detail/page.tsx L31-320; customers/whatsapp-button.tsx L7-36; customers/archive-customer-button.tsx L66-103; customers/new/add-customer-form.tsx; customers/detail/edit/edit-customer-form.tsx L34-100; site-analysis/page.tsx L47-174; site-analysis/shared.tsx L14-187; site-analysis/create-site-dialog.tsx L30-46; site-analysis/site-forms.tsx L20-160; site-analysis/detail/page.tsx L40-414; detail/share-site-report-button.tsx L25-115; detail/site-report.tsx L52-280; site-analysis/machine/page.tsx L29-151; site-analysis/readings-tables.tsx L25-190; site-analysis/fleet-by-site.tsx L18-82; dashboard/page.tsx L67-242; components/dashboard/date-range-filter.tsx L20-133; profit-detail-button.tsx L33-91; payment-collection-status.tsx L15-150; components/shell/notification-bell.tsx L10-37; settings/page.tsx L35-47; settings/bank-accounts-section.tsx L35-165
- docs/authorization-matrix.md L15-142
