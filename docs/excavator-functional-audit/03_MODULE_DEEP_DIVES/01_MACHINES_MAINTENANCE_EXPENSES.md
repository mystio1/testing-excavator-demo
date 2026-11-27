# Module deep dive — Machines, Maintenance and Machine Expenses

**Modules covered:** Machines (`/excavators`), Machine detail tabs (Work / History / Service / Details), Operator ↔ machine assignment, Machine current site, Service & maintenance, Expenses (`/expenses`), Machine Performance.

## Module summary (business outcome)

- **Machines.** The owner registers each excavator with a name, number, brand, model, purchase date, starting hour meter and an optional service interval. The machine then carries a live hour meter, a status (Idle or Working), one assigned operator and one "current site".
- **History.** Every job, service and expense stays attached to the machine permanently. A machine can only be *archived*, never deleted.
- **Maintenance.** The owner records component-level services: what was done to each component and what it cost. From these the app computes when the next service is due and raises alerts.
- **Expenses.** The owner records money spent on a machine (diesel bought, repairs, parts, tyres, transport, other). Expenses feed the dashboard profit figure.
- **What is missing.** There is no breakdown or "under service" state that anything actually sets. There is no owned-versus-rented distinction, and no profit figure per machine.

## Reconciliation notes (main investigator)

Independently re-verified by the main investigator against the source:

| Claim | Verified how | Result |
|---|---|---|
| "SERVICE" status is never written | grep of `"SERVICE"` in `src/lib`, `src/app`: only reader `dashboard.ts:524` | **Confirmed** |
| Expenses have create + delete only | `src/app/api/expenses/route.ts` exports GET/POST, `[id]/route.ts` exports DELETE only | **Confirmed** |
| Maintenance = service-record cost + REPAIR/SERVICE/PARTS/TYRES expenses | `dashboard.ts getProfitOverview` L945-947 | **Confirmed** — double-count risk is real |
| Operator-job approval sets machine IDLE + meter unconditionally | `operatorWorkRequests.ts approveWorkRequest` L461-464 | **Confirmed** |
| Machine Performance adds Direct bills' `totalAmount` (incl. GST) | `siteAnalysis.ts getMachineEarnings` L360-363, L400-404 vs `dashboard.ts` L908 (`subtotal`) | **Confirmed** — upgraded from D to B |

> **How to read this deep dive.** Each feature (F-number) follows the Part 5 deconstruction standard in compressed form:
> *Who / Entry point* = 5.1–5.2 · *Field table* = 5.3 · *Behaviour / Checks* = 5.4 · *Calculations register* = 5.5 · *Connected modules* = 5.6 · *Status tables* = 5.7 · *Historical impact* = 5.8 · *Limitations / Gaps* = 5.10.
> Business outcome (5.9) is stated in the module summary at the top.
> Evidence grades: **A** runtime-verified (none in this audit — no application was run), **B** traced end to end through the code, **C** partly traced, **D** inferred, **E** unverified.
> Paths are relative to `excavator-manager/`. Function names are the authoritative reference; line numbers are as read on 2026-11-24 and may drift.

Every owner API below calls `requireBusinessApi()`, which only accepts role `OWNER` (src/lib/session.ts L31-34, L54). The operator portal has no machine-admin, service or expense features: grepping src/app/(operator) and src/app/api/operator for "service/expense/breakdown" finds only the generic API wrapper.

---------------------------------------------------------------------------------------------------

## 1. Feature list

### F1. Add machine
- **Who:** Owner. **Entry:** `/excavators`, then "Add Machine", then `/excavators/new` (src/app/(app)/excavators/page.tsx L29-36; new/add-excavator-form.tsx). **API:** POST `/api/excavators` (src/app/api/excavators/route.ts L14-21). It calls `createExcavator` (src/lib/services/excavators.ts L74-107).
- **Prerequisites:** none. A business can add a machine with no operator, site or customer.

| Field | Required | Meaning | Validation (server: src/lib/validation/excavator.ts `addExcavatorSchema` L11-19) | Default / business impact |
|---|---|---|---|---|
| name | Yes | Display name ("JCB-01") | trim, min 1 (L12). **No uniqueness check** | Shown on cards, bills (bills read the name live, see F14), pickers |
| machineNumber | No | Registration no. | trim, optional (L13). **No uniqueness check** | `""` becomes null (excavators.ts L88). Appended "(no.)" in alerts (dashboard.ts L46-48) |
| brand | No | Make | trim optional (L14) | `""` becomes null. Display only |
| model | No | Model | trim optional (L15) | `""` becomes null. Display only |
| purchaseDate | No | Purchase date | must parse if non-empty (L6-9). Future dates allowed | null if blank (L91). Display only (Details tab). Not used in any calculation |
| startingHourMeter | Yes | Meter reading when added | coerce number, 0 to 10,000,000 (L17). UI default 0, step 0.1 (add-excavator-form.tsx L78-87) | Rounded to 2 dp (`roundHours`, workSessions.ts L31-33). **Also copied to currentHourMeter** (excavators.ts L92-93). Fallback anchor for service-due when the machine has no service record (serviceStatus.ts L23). **Cannot be changed later** (see F2) |
| serviceIntervalHrs | No | Per-machine service interval override | coerce number, 1 to 100,000, optional (L18). UI step 1, min 1, placeholder = business default (add-excavator-form.tsx L89-104) | null = use `Business.defaultServiceIntervalHrs` (default 350, schema L31). Only used when the last service record has no `nextServiceDueHour`, or when there is no record (serviceStatus.ts L22-24) |

- **Behaviour:** inside a transaction. `sortOrder = max(sortOrder)+1` (L81, L86), so the new machine goes to the end. Status defaults to "IDLE", isArchived to false, version to 0 (schema L184-205). An audit row `excavator.create` is written (L97-104). On success the UI redirects to the detail page (add-excavator-form.tsx L20-21).
- **Not captured anywhere:** owned vs rented-in, purchase cost, depreciation, insurance, capacity/tonnage, fuel tank size. There is no field for any of them in the `Excavator` model (schema L184-224).

### F2. Edit machine
- **Who:** Owner. **Entry:** detail page, "Edit", `/excavators/detail/edit?id=` (detail/page.tsx L110-119). **API:** PATCH `/api/excavators/[id]` (route.ts L25-34), which calls `updateExcavator` (excavators.ts L183-219).
- **Fields:** name, machineNumber, brand, model, purchaseDate, serviceIntervalHrs (edit-excavator-form.tsx L56-71 form body). `editExcavatorSchema` = add schema minus startingHourMeter, plus an optional `startingHourMeter` and `expectedVersion` (validation/excavator.ts L23-27). **The service ignores startingHourMeter even if it is sent** (excavators.ts L196-206 writes only name/machineNumber/brand/model/purchaseDate/serviceIntervalHrs). currentHourMeter and status cannot be edited here either.
- **Checks:** row lock (`lockOwnedExcavator`, workSessions.ts L49-53). Optimistic version check returns RESOURCE_MODIFIED (excavators.ts L194); the UI then shows "Reload latest version" (edit form, about L142-146). Clearing "Service Every" sends `undefined`, which stores null and reverts to the business default (L179, service L204). Clearing purchaseDate stores null.
- **Historical impact:** nothing is snapshotted. A name or number change shows up immediately on every past bill view, PDF and Excel, because bills read `excavator.name/machineNumber` live (bills.ts `getBillDetail` L1075-1106, L1131; billSummary.ts L25, L74; `listBillsForExport` L1026-1027). BillItem has no machine-name snapshot (schema L789-800, which snapshots only siteName). Changing serviceIntervalHrs immediately re-computes due/overdue for every view (live calculation, see C1). Audit `excavator.update` stores before and after (L208-216).

### F3. Archive ("Delete") machine
- **Who:** Owner. **Entry:** two UIs. (a) The detail page "Delete" dialog (detail/delete-excavator-button.tsx; the text at L30-32 says history/service/bills "stay on record. This cannot be undone"). (b) The ArchiveButton on the edit page (edit-excavator-form.tsx L52-54, L73-76, L154). **API:** DELETE `/api/excavators/[id]?expectedVersion=` (route.ts L36-46), which calls `archiveExcavator` (excavators.ts L223-251).
- **Behaviour:** sets `isArchived=true` and bumps the version, then writes an audit row `excavator.archive`. It is idempotent: an already-archived machine returns ok (L234). Neither UI sends expectedVersion, so the version check is skipped (`isStale(..., undefined)`).
- **Checks NOT made (B):** no check for status WORKING or an ACTIVE WorkSession. No check for ACTIVE/PENDING OperatorWorkRequests. It does not end the OperatorAssignment or clear `currentOperatorId`. It does not clear `currentSiteId`. No unbilled-work warning (L229-250 contain none of these).
- **After archive:**
  - Hidden from the machine list, pickers and expense machine dropdown (`listExcavators` L22; `listExcavatorOptions` L314).
  - Hidden from dashboard machine counts and service alerts (dashboard.ts L79, L147, L235, L424).
  - Hidden from Machine Performance (siteAnalysis.ts L348), working-by-site (L613) and fleet-by-site (L652).
  - **Still reachable by URL.** `getExcavatorDetail` has no isArchived filter (excavators.ts L112-113), and the detail page still offers Edit, Delete, Start Work, Add Service and Assign.
  - `excavatorInBusiness` includes archived machines (L357-362), so work history and the service tab still load.
  - **Still included in Business Profit Overview.** Its machine list has no archive filter (dashboard.ts L928), and service, expense and work aggregates are by business, not by machine.
  - The operator portal still resolves the archived machine through the open assignment (workSessions.ts `getOperatorPortalState` L1052-1062, no isArchived). `startOperatorWork` also has no archive check (operatorWorkRequests.ts L72-76). So the operator can keep starting jobs on an archived machine.
  - startWork, createServiceRecord and createExpense only call `lockOwnedExcavator`, which does not check isArchived (workSessions.ts L49-53, L184-186; serviceRecords.ts L234-236; expenses.ts L39). Via the API, all of them still succeed on an archived machine.
- **There is no unarchive/restore function or UI** (no code sets isArchived back to false).
- **Hard delete is impossible by design.** WorkSession, ServiceRecord, ExcavatorExpense and BillItem have `onDelete: Restrict` on the excavator (schema L435, L642, L688, L803). Only the support console wipes a whole business (support.ts L194-197).

### F4. Reorder machines
- **Who:** Owner. **Entry:** "Reorder" on `/excavators` (reorder-machines.tsx L33-35). **API:** PUT `/api/excavators/reorder` {orderedIds: 1..500} (reorder/route.ts L6-17), which calls `reorderExcavators` (excavators.ts L332-355).
- **Behaviour:** takes a business-level lock (L337). Ids that do not belong to the business are ignored (L338-343). Positions are written as 1..n, and only rows whose position changed are updated (L345-352). Archived machines keep their old sortOrder. The order is used by the list, pickers, performance and fleet views (L23, L323; siteAnalysis.ts L350, L666). Cosmetic only, with no historical impact.

### F5. Machine list (`/excavators`) and machine card
- **Who:** Owner. **API:** GET `/api/excavators` calls `listExcavators` (excavators.ts L19-72).
- **Per card** (components/machine-card.tsx L13-52):
  - name, number, status badge
  - Site = name of the ACTIVE WorkSession's site, otherwise `Excavator.currentSite`, otherwise "—" (excavators.ts L67)
  - Operator = `currentOperator.name` (L68)
  - Hour Meter = currentHourMeter
  - Service = "Overdue by X hrs" or "Due in X hrs", from `computeServiceStatus`. The last service is ordered by serviceDate desc, createdAt desc, id desc (L32-35, L44-52).
- The page also shows the `MachinePerformanceList` (F13) and the Reorder control (page.tsx L49-58).

### F6. Machine detail page (`/excavators/detail?id=`)
- **API:** GET `/api/excavators/[id]` returns `getExcavatorDetail` plus `listSiteOptions` (route.ts L11-23; excavators.ts L111-178).
- **Header:** number, currentHourMeter, a service line ("Service overdue by X" or "Service due in X hrs"), and the status badge (detail/page.tsx L61-83).
- **Idle alert:** `idleDays = floor((now − (lastCompletedSession.endDate ?? excavator.createdAt)) / 86,400,000)`. It shows when `status==="IDLE" && idleDays >= 7` (excavators.ts L109, L136-139, L165-167). It appears only on this page and is deliberately excluded from the bell (dashboard.ts L134-138).
- **Cards:** AssignedOperatorCard (F8) and SiteCard (F9).
- **Tabs** (detail/page.tsx L103-149):
  - **Work:** current work, operator requests, start/stop (F10).
  - **History:** work sessions (F15).
  - **Service:** F11 and F12.
  - **Details:** brand, model, purchase date, starting hour meter. Read-only.
- `defaultSiteName = currentSite.name ?? site of the latest WorkSession by startDate` (any status) (L144-148, L176). It prefills Start Work.
- **Not shown on the detail page:** expenses for this machine, OperatorAssignment history (`getAssignmentHistoryForExcavator` is defined at operatorAssignments.ts L162-168 but **never imported anywhere**), and machine profit.

### F7. Machine status (WORKING / IDLE / SERVICE)
`Excavator.status` is a free string, default "IDLE" (schema L194). Every write is listed below (grep of `"WORKING"|"IDLE"|"SERVICE"` across src):

| Event | Sets | Evidence |
|---|---|---|
| Admin Start Work | WORKING, currentHourMeter = startHourMeter | workSessions.ts `startWork` L229-232 |
| Admin Stop Work | IDLE, currentHourMeter = endHourMeter | `stopWork` L304-307 |
| Admin deletes an ACTIVE work session | IDLE (meter unchanged) | `deleteWorkSession` L1017-1022 |
| Operator starts a job in the portal | WORKING, currentHourMeter = startHourMeter | operatorWorkRequests.ts `startOperatorWork` L105-108 |
| Admin approves an operator job | IDLE, currentHourMeter = endHourMeter, currentSiteId = approved site | `approveWorkRequest` L461-464 |
| Admin rejects an operator job | unchanged (stays WORKING) | `rejectWorkRequest` L491-493 doc, L506-509 |
| **"SERVICE"** | **never set by any code path** | No writer exists. It is only read: dashboard.ts L524 `underService` count, status-badge.tsx L7 "Under Service" |

- Adding a service record, adding an expense, assigning an operator, setting a site, archiving and editing **never change status** (B, by inspecting each function above).
- So the dashboard "Under Service" card is always 0.
- There is no manual status control and no breakdown status.
- `approveWorkRequest` sets IDLE even if another ACTIVE operator request exists on the same machine. Several requests can coexist (operatorWorkRequests.ts L60-63 doc). D: the machine can show IDLE while an operator job is still open.

### F8. Operator assignment (assign / change / end)
- **Who:** Owner. **Entry:** AssignedOperatorCard on the detail page. The dropdown comes from `/api/operators/options`, which is `listOperatorOptions` and excludes archived operators (assigned-operator-card.tsx L19; operators.ts L846-853). Buttons: "Assign"/"Change" (assign-operator-dialog.tsx) and "End" (end-operator-assignment-button.tsx L1-27).
- **API:** POST `/api/excavators/[id]/assign-operator` {operatorId} calls `assignOperator`. DELETE calls `endOperatorAssignment` (assign-operator/route.ts L9-31).
- **Field:** operatorId, required (validation/operatorAssignment.ts L9-11). There is no start-date field: the assignment always starts "now" (operatorAssignments.ts L36, L71). **It cannot be backdated.**
- **assignOperator** (L19-101):
  - locks the machine (L26)
  - checks the operator belongs to the business (L30-34). **It does not check the operator is archived**; only the UI filters that.
  - finds every ACTIVE assignment where `excavatorId = this machine OR operatorId = this operator`, and marks each ENDED with endDate=now (L43-56)
  - clears `currentOperatorId` on the other machines this operator left (L58-64)
  - creates a new ACTIVE OperatorAssignment (L66-74), sets `Excavator.currentOperatorId` (L76-79), and writes audit `operator.assignment.start` (L81-97)
  - **Rule (B):** one operator is on at most one machine, and one machine has at most one operator. Re-assigning the same operator closes the row and opens a new one, so history gets an extra row.
- **Not checked on assign:** whether the machine has an ACTIVE WorkSession, or whether either machine has an open operator request. `WorkSession.operatorId` stays the snapshot taken at start (workSessions.ts L221).
- **endOperatorAssignment** (L103-160): ends the ACTIVE rows and nulls `currentOperatorId`. It also writes a legacy audit when only the pointer existed (L143-156). It does not check for an active job.
- **startWork requires a current operator** (workSessions.ts L187-189). The UI hides the form when there is no operator (start-work-dialog.tsx L138-141).
- **Archiving an operator does not end their assignment** (operators.ts `archiveOperator` L278-307 only flags the operator). The machine keeps `currentOperatorId` pointing at the archived operator, and admin startWork still succeeds (it only checks non-null) (D/B: traced through code, not run).

### F9. Machine current site (SiteCard)
- **Who:** Owner. **Entry:** SiteCard "Set"/"Change" (detail/site-card.tsx). **API:** PATCH `/api/excavators/[id]/site` {siteName, previousSiteStatus?} (site/route.ts L10-20), which calls `setExcavatorSite` (excavators.ts L256-310).

| Field | Required | Meaning | Validation | Impact |
|---|---|---|---|---|
| siteName | Yes | Pick an existing site or type a new one | trim min 1 (validation/excavator.ts L33) | `findOrCreateSite` matches case- and space-insensitively, or creates a new Site (sites.ts L27-34). Sets `Excavator.currentSiteId` |
| previousSiteStatus | Only sent when leaving a different site (site-card.tsx L42-43, L51) | Status of the site being left: Ongoing (ACTIVE), Partially Completed (PARTIAL), Completed, Deactive (ON_HOLD) | enum SITE_STATUSES (validation/site.ts L6-13; excavator.ts L35) | If it differs from the old site's status, the old Site.status is updated, with audit reason "machine moved to another site" (excavators.ts L274-292) |

- **Behaviour:** no-op if it is the same site (L269). Picking a status is optional: the UI preselects the old site's current status (site-card.tsx L72).
- **Not done:**
  - The **new** site's status is not changed. Moving a machine onto a COMPLETED site leaves it COMPLETED (B, L294-297 only update the excavator).
  - An ACTIVE WorkSession is not checked or moved. Its `siteId` is unchanged.
  - Other machines still at the old site are not considered before marking it COMPLETED.
- **Other writers of currentSiteId:** only `approveWorkRequest` (operatorWorkRequests.ts L463). That one never asks about the old site's status. **startWork does not set currentSiteId** (workSessions.ts L215-232).
- The schema comment lists Site.status as "ACTIVE|COMPLETED|ON_HOLD" (schema L256), but validation also allows PARTIAL. This is a documentation drift.

### F10. Start / Stop work from the machine page (machine-side only)
- **Start Work dialog** (detail/start-work-dialog.tsx; shown only when there is no active work and no open operator requests, current-work-tab.tsx L180-209). It asks for:
  - **Customer** (required). Auto-filled from the chosen site's customer, can be overridden, and a new customer can be added inline (L85-88, L151-170, L285-330).
  - **Site** (required). Free text with a datalist, prefilled with `defaultSiteName` (L189-216).
  - **Start Date** (required, default today) (L221-224).
  - **Starting Hour Meter** (required, default currentHourMeter, min 0) (L228-239).
  - **Tool Used** (Bucket/Breaker/Chaining). Required **client-side only** (L99-102, L244-247). The server has `attachment` optional (validation/workSession.ts L33-40).
  - The operator is displayed, not chosen (L147).
- **startWork server rules** (workSessions.ts L180-249):
  - machine exists (L184-186) and has an operator (L187-189)
  - customer is in the business and not archived (L193-196)
  - no ACTIVE WorkSession on this machine (L198-202)
  - no ACTIVE/PENDING OperatorWorkRequest (L204-210)
  - **No check that startHourMeter ≥ currentHourMeter.** The meter is **set** to the typed value, so it can move backward (L229-232). No check of startDate against the last job.
- **Stop Work dialog** (stop-work-dialog.tsx). It asks for:
  - End Date (default and min = start date) (L95-105)
  - End Hour Meter (required, prefilled with currentHourMeter) (L71, L114-125)
  - optional Diesel litres and Remaining diesel (L140-161)
  - optional Notes (L173-176)
- **stopWork** (workSessions.ts L251-325): requires endHourMeter > session.startHourMeter (L269-272). `totalHours` = the sum of approved WORK readings if any exist, otherwise `endHourMeter − startHourMeter` (L274-275). The machine is set to IDLE and **meter = endHourMeter** (set, not raised) (L304-307).

### F11. Service records (Add Service)
- **Who:** Owner. **Entry:** Service tab, "Add Service" (service-tab.tsx L90-96; add-service-dialog.tsx). **API:** POST `/api/excavators/[id]/service-records` (service-records/route.ts L8-22), which calls `createServiceRecord` (serviceRecords.ts L227-307).

| Field | Required | Meaning | Validation (validation/serviceRecord.ts) | Default / impact |
|---|---|---|---|---|
| serviceDate | Yes | Date serviced | `dateString`: non-empty and parseable (L50; workSession.ts L7-11). Future dates allowed | UI default today (add-service-dialog.tsx L126-127). Decides which record is the "last service" (sorted by serviceDate desc) |
| hourMeterAtService | Yes | Meter at service | 0 to 10,000,000 (L51) | UI default currentHourMeter (L130-139). Rounded to 2 dp. **If it is greater than currentHourMeter, the machine meter is raised to it** (serviceRecords.ts L285-292). No lower bound against earlier records |
| notes (record) | No | Record-level notes | trim optional (L52) | **No UI input.** The dialog never sends it (add-service-dialog.tsx L100-104) |
| items[] | Yes, 1 to 200 | Components touched | min 1 "Select at least one component" (L53) | Save is disabled when 0 are selected (L284) |
| items.serviceItemId | Yes | Catalog component | must belong to the business (serviceRecords.ts L240-242) | |
| items.action | Yes | Inspected/Serviced/Repaired/Replaced/Changed/Cleaned/Greased/Not Done/Not Required/Other (L15-26) | enum | UI default "Serviced" (dialog L28-30). `done = !(Not Done/Not Required)` (serviceRecords.ts L275) |
| items.cost | No | Line cost ₹ | coerce, 0 to 99,999,999, default 0 (L43) | Rounded to the paisa. Record cost = exact sum (serviceRecords.ts L259-260, L268) |
| items.brand / notes | No | Part brand / note | trim optional (L44-45) | Shown in component and replacement history |

- **ServiceRecord.serviceType** exists in the schema (L635) but is never written (createServiceRecord L262-283 omits it).
- **Behaviour:** locks the machine. Creates the ServiceRecord and its items (L262-283), may raise the meter (L285-292), and writes audit `serviceRecord.create` with totalCost and the meter change (L295-303).
- **Status is not changed. Availability is not blocked.** A service can be logged while the machine is WORKING. Nothing in L233-306 checks status or isArchived.
- **nextServiceDueHour:** see C2.
- **"Suggested from last service":** items marked Not Done or Not Required in the **latest** record are pre-checked (getPreviousServiceSummary L163-184; dialog L50-57, L143-156).
- **Lifecycle:** create only. **There is no update or delete for ServiceRecord or ServiceRecordItem anywhere** (grep for `serviceRecord.update/delete`: only the support wipe, support.ts L194).

### F12. Service catalog, component page, histories, due status
- **Catalog:**
  - Seeded at business registration with 58 default components across 8 categories (auth.ts L81-87; DEFAULT_COMPONENT_LIBRARY serviceRecords.ts L73-125).
  - **Each default gets a guide interval** (GUIDE_INTERVAL_HOURS L15-71, e.g. Engine Oil 500, Hydraulic Oil 250, Bucket Teeth 50, Greasing 50, Track parts 250). O-Rings, Cleaning and Repair get null (L9-14).
  - The schema comment says intervals are "left null unless the owner configures one" (schema L611-615). The code contradicts this, and **there is no UI or API to set or edit a component interval**: no `serviceItem.update` exists.
  - "Add New Component" is inline in the dialog. It takes name (required) and category (enum, default Other) (dialog L295-354; POST `/api/service-items`, service-items/route.ts L6-13; `createCustomComponent` L154-158). The new component always has **no interval**.
  - There is no component delete or rename, and no duplicate-name check.
- **Service tab** (service-tab.tsx; data from GET `/api/excavators/[id]/service-tab`, service-tab/route.ts L12-27):
  - **Summary:** Current Meter, Last Service (meter of history[0]), Next Service (`serviceStatus.nextDueHour`), Remaining ("Overdue by X" or "X hrs") (L57-88).
  - **"Needs Attention":** the flagged items (L100-115).
  - **"Component Status":** the action from the **latest record only**. Anything not in the latest record shows "Never serviced", even if an older record serviced it (L117-143; getPreviousServiceSummary only loads lastRecord, L164-168). This is misleading (Gap G12).
  - **Service History:** up to 500 records, each expandable with items and cost (L145-180; listServiceHistory L211-218).
  - **Replacement History:** items with action "Replaced" (L182-202; getReplacementHistory L199-209).
- **Component page** `/excavators/detail/component?id=&componentId=` (component/page.tsx L20-72; API components/[componentId]/route.ts L7-22; getComponentHistory L190-197): every record item for that component on this machine, with action, date, meter, brand, cost and notes. Read-only.
- **Machine-level due status:** computeServiceStatus (C1). It is used on the card, detail header, service tab, dashboard and bell. The bell alerts are "service is overdue by X hrs" (danger) and "service due in X hrs" (warning, when dueSoon) (dashboard.ts `getAlerts` L197-222).
- **Component-level predictive alerts** (dashboard.ts `getComponentMaintenanceAlerts` L76-132): see C3. Top 8, mixed into the bell (L172, L225).
- **Settings:** `defaultServiceIntervalHrs` (default 350) and `maintenanceAlertThresholdHrs` (default 50) (schema L31-32). Both are validated min 1 (validation/settings.ts L9-10) and saved by `updateBusinessProfile` (settings.ts L96-117). GET `/api/settings/service-interval` returns only the default interval, for the form placeholder (settings/service-interval/route.ts L7-16).

### F13. Machine Performance (Machines page)
- **API:** GET `/api/excavators/performance?period=day|week|month|year&today=yyyy-MM-dd`, default month (validation/excavator.ts L41-48; performance/route.ts L8-13). It calls `getMachineEarnings` (siteAnalysis.ts L330-439).
- **Buckets:** day = last 7 days, week = 8 (weeks start Monday), month = 12, year = 5. These are UTC-anchored (L302-322, L331-341).
- **Per machine and bucket** (non-archived machines only, L347-351):
  - `revenue` = Site-Analysis entry revenue (billed work at its bill-share, unbilled work at the site rate on the date) (L352-359, L389-394)
    - plus Summary-bill lines without a work session, on the bill date (L373-376, L395-399)
    - plus **Direct bills' `totalAmount`** for that machine, on the bill date (L360-363, L400-404)
  - `hours`: sum of entry hours, plus the hours on Summary-bill lines
  - `unpricedHours`: hours where the site rate is missing (L357)
- **missingRateSites:** sites with Bucket/Breaker work in the window that have no rate (L364-370, L429-437).
- **UI:** fleet total revenue and hours for the selected bucket (machine-performance-list.tsx L60-61). Per-machine bars use `revenue / max revenue` (L159, L203).
- **It shows revenue and hours only.** No expense, service cost, diesel cost or profit is attributed per machine anywhere in the app (Gap G9).
- **Inconsistency (D):** Direct bills count `totalAmount` here, which contains GST (schema Bill L725-737: subtotal, cgst/sgst/igst, totalAmount; bills.ts L717/L835 `totalAmount: amounts.total`). Profit Overview uses `subtotal` and says "GST is left out" (dashboard.ts L887, L908). So per-machine revenue includes GST on direct bills while the dashboard excludes it. Grade D: I did not trace how `amounts.total` is built.

### F14. Expenses module
- **Who:** Owner. **Entry:** nav item "Expenses" `/expenses` (components/shell/nav-items.ts L12), plus links from the profit detail dialog (components/dashboard/profit-detail-button.tsx L73, L102). Page: src/app/(app)/expenses/page.tsx.
- **API:**
  - GET `/api/expenses?from&to&excavatorId` returns the latest **200** expenses plus the machine options (api/expenses/route.ts L9-18; services/expenses.ts `listExpenses` L15-35)
  - POST `/api/expenses` calls `createExpense` (route.ts L20-27; expenses.ts L37-60)
  - DELETE `/api/expenses/[id]` calls `deleteExpense` (api/expenses/[id]/route.ts L6-13; expenses.ts L62-77)

| Field | Required | Meaning | Validation (validation/expense.ts `createExpenseSchema` L20-26) | Default / impact |
|---|---|---|---|---|
| excavatorId | Yes | Machine charged | trim min 1, max 128. Server checks the machine is in the business (lockOwnedExcavator, expenses.ts L39). **Archived machines are not rejected** (UI lists active ones only, `listExcavatorOptions`) | "every expense belongs to a machine" (page L111-113) |
| date | Yes | Expense date | `YYYY-MM-DD`, parseable (L14-17). Future dates allowed | UI default today (page L151-152). Stored as UTC midnight (expenses.ts L44). Decides the dashboard period |
| type | Yes | DIESEL / REPAIR / SERVICE / PARTS / TYRES ("Tyres / Tracks") / TRANSPORT / OTHER (L3-12) | enum | UI default DIESEL (page L137-145). Decides the profit bucket (C5) |
| amount | Yes | ₹ | number > 0, ≤ 1e9 (L24). UI min 0.01, step 0.01 (page L147-148) | Rounded to 2 dp (expenses.ts L46) |
| notes | No | e.g. supplier/litres | trim, max 300 (L25) | display only. **Diesel litres are not captured as a number** |

- **Behaviour:** create writes audit `expense.create`. Delete is a hard delete, with a confirm() and audit `expense.delete` storing the before-image. After either, the UI refreshes `/api/expenses*` and `/api/dashboard*` (page L91, L173).
- **There is no edit**: no update function or route exists (grep `excavatorExpense.update`: none). Correction means delete and re-create.
- **No duplicate detection. No link to ServiceRecord or WorkSession. No attachment/receipt. No vendor or payment-mode field.**
- **Page total** = sum of the ≤200 listed rows (page L34, L52-55). With more than 200 expenses, the header total understates (D). Although the API supports from/to/excavatorId filters, **the UI has no filter controls** (the page always calls the bare KEY, L28-32).
- The schema header still says "Expenses (schema only this session — no UI yet)" (schema L673-675). That is stale.

### F15. Work-history tab (machine)
- **API:** GET `/api/excavators/[id]/work-history?customerId&operatorId&site&from&to&limit&cursor` (work-history/route.ts L11-28), which calls `listWorkHistory` (workSessions.ts L1106-1141).
- All WorkSessions of the machine, any status, ordered by startDate desc and paginated. Filters: customer, operator (the session snapshot), site name (case-insensitive contains), and a startDate range.
- Rows offer Edit Session, Edit Reading and Delete Reading (work-history-tab.tsx L18-20, L136-200). Their internals belong to the work-session agent.
- `deleteWorkSession` is refused once the session is billed (workSessions.ts L1010-1013).

---------------------------------------------------------------------------------------------------

## 2. Calculations register

**C1. Machine service status** (serviceStatus.ts `computeServiceStatus` L21-34)
```
interval      = excavator.serviceIntervalHrs ?? business.defaultServiceIntervalHrs          (L22)
lastServiceHr = lastServiceRecord.hourMeterAtService ?? excavator.startingHourMeter            (L23)
nextDueHour   = lastServiceRecord.nextServiceDueHour ?? (lastServiceHr + interval)             (L24)
dueInHours    = round2(nextDueHour − excavator.currentHourMeter)                               (L25)
threshold     = business.maintenanceAlertThresholdHrs ?? 50                                    (L26, L1)
overdue       = dueInHours < 0                                                                 (L30)
dueSoon       = 0 ≤ dueInHours ≤ threshold                                                     (L31)
```
- "Last service record" is ordered serviceDate desc, then createdAt desc, then id desc (excavators.ts L33, L126). The bell uses serviceDate desc only, with no tiebreak (dashboard.ts L155). With two records on the same date, the bell and the machine page may pick different records (D).
- Only the **latest** record counts. Earlier records are ignored.

**C2. ServiceRecord.nextServiceDueHour** (serviceRecords.ts L247-254)
```
nextServiceDueHour = min over items where action ∉ {Not Done, Not Required} AND serviceItem.defaultIntervalHours != null
                     of round2(hourMeterAtService + defaultIntervalHours);   null if no such item
```
- When it is non-null, it **overrides the machine's interval and the business default** in C1.
- Example: a 350 h machine service that also ticks "Greasing" (50 h) or "Bucket Teeth" (50 h) sets the next machine service to +50 h. Ticking only Engine Oil (500 h) sets +500 h (B, by arithmetic on the code).

**C3. Component predictive alert** (dashboard.ts `getComponentMaintenanceAlerts` L76-132)
```
lastHour   = hourMeterAtService of the most recent (by serviceDate) record item with done=true for (machine, component)
             ?? excavator.currentHourMeter                                                       (L100-104, L110)
dueAtHour  = lastHour + component.defaultIntervalHours                                           (L111)
dueInHours = round2(dueAtHour − currentHourMeter)                                                (L112)
alert if dueInHours ≤ 15 (COMPONENT_ALERT_LEAD_HOURS, L50); danger if < 0 else warning; top 8 by dueInHours (L51, L128-131)
```
- A component that was never serviced always gets `dueInHours = interval` (≥ 50), so it **never alerts** (B, by arithmetic).
- Done items are counted across all records, not just the latest. This differs from C1 and the Component Status panel.

**C4. Service record cost:** `ServiceRecord.cost = Σ round2(item.cost)`, using Decimal arithmetic (serviceRecords.ts L259-260).

**C5. Profit Overview, machine-related expense parts** (dashboard.ts `getProfitOverview` L897-1016)
```
serviceCost     = Σ ServiceRecord.cost where serviceDate in range                                 (L920, L945)
repairCost      = Σ Expense.amount type ∈ {REPAIR, SERVICE, PARTS, TYRES} in range                (L921-925, L943-946)
maintenanceCost = serviceCost + repairCost                                                        (L947)
otherCost       = Σ Expense.amount type ∈ {TRANSPORT, OTHER}                                      (L948)
dieselCost(m)   = Σ DIESEL expenses of machine m in range, if any exist;
                  else litres(m) × business.dieselPricePerLitre (when the price is set); else 0 ("no-price")    (L950-972)
expensesTotal   = salary + maintenanceCost + dieselCost + otherCost                               (L975)
netProfit       = revenue − expensesTotal                                                         (L976)
margin%         = round1(netProfit / revenue × 100) if revenue > 0 else 0                         (L978)
```
- Diesel is all-or-nothing per machine and period. A single small DIESEL expense in the period **replaces** all litre-based costing for that machine, even if it covers only part of the litres (B, L960-968).

**C6. Idle days:** `floor((now − (latest COMPLETED session.endDate ?? createdAt)) / 1 day)`, and the alert shows if status is IDLE and idleDays ≥ 7 (excavators.ts L109, L165-167). An approved operator job creates a COMPLETED session (operatorWorkRequests.ts L452), so it resets the count. A service record does not.

**C7. Machine performance:** see F13. `revenue(m,b) = entryRevenue + unlinkedBillItem.amount + directBill.totalAmount`, and `hours(m,b) = entryHours + unlinkedBillItem.hours` (siteAnalysis.ts L389-404).

**C8. Start/stop meter effects:**
- start: `currentHourMeter := startHourMeter` (workSessions.ts L231)
- stop: `:= endHourMeter` (L306)
- service: `:= max(current, hourMeterAtService)` (serviceRecords.ts L286-290)
- approve operator job: `:= endHourMeter` (operatorWorkRequests.ts L463)
- daily-log approvals use `syncExcavatorMeter` set or raise (workSessions.ts L94-114)

---------------------------------------------------------------------------------------------------

## 3. Scenario answers

| # | Scenario | Supported? | Actual behaviour | Records affected | Ev. |
|---|---|---|---|---|---|
| S1 | Same machine at two active sites | Not prevented | A machine has one `currentSiteId` but its ACTIVE WorkSession has its own `siteId`. startWork never syncs them (workSessions.ts L212-232), and setExcavatorSite never touches the session (excavators.ts L294-297). With currentSite=A and a job at B, `getMachinesWorkingBySite` adds **both** site ids, so the machine is listed as working at A **and** B (siteAnalysis.ts L619-633). The card and fleet views prefer the job site (excavators.ts L67; siteAnalysis.ts L672). One machine cannot have two ACTIVE WorkSessions (workSessions.ts L198-202) | Excavator.currentSiteId, WorkSession.siteId | B |
| S2 | Machine moves site | Yes, via SiteCard | currentSiteId becomes the new site, found or created by name. The old site gets the status picked by the owner (optional), with an audit row. The new site's status is unchanged. An active job keeps its old siteId, so its hours and revenue stay on the old site. An operator approval moves the site without asking about the old site's status (operatorWorkRequests.ts L463) | Excavator, old Site.status, AuditLog | B |
| S3 | Machine replaced mid-assignment / mid-job | Partial | There is no "replace machine" or transfer function. To replace: stop the job on machine A (A goes IDLE), assign the operator to machine B (this ends A's assignment and clears A's operator, operatorAssignments.ts L43-64), then start a new job on B. A job cannot be moved between machines: `updateWorkSessionSchema` has no excavatorId field (validation/workSession.ts L140-153). If the operator is reassigned while A's job is ACTIVE, the job keeps the old operator snapshot (workSessions.ts L221), but the Work tab shows the machine's *current* operator name (current-work-tab.tsx L227), which is misleading | OperatorAssignment, Excavator.currentOperatorId | B |
| S4 | Breakdown mid-shift | Not supported as a concept | There is no breakdown status, downtime record or "SERVICE" status writer (F7). The workaround is to stop work (machine goes IDLE with the end meter), then add a Service record and/or a REPAIR expense. Notes are free text. Downtime hours are not measured. The dashboard "Under Service" card stays 0. A service can even be logged while the machine is WORKING with no status change | WorkSession, ServiceRecord, ExcavatorExpense | B |
| S5 | Archive a machine with history; while working | Allowed even while WORKING | Soft flag only. History, bills, service records and expenses are kept (FKs are Restrict, so hard delete is impossible). **No guard against an active job, pending operator requests or an assigned operator.** The machine stays WORKING with an open job. It disappears from lists, so the job can only be stopped via the detail URL. The operator portal still shows it and allows new operator jobs. It is still counted in Profit. There is no unarchive | Excavator.isArchived, AuditLog | B (code), runtime not exercised |
| S6 | Machine data edited after the fact | Yes | Name, number, brand, model, purchase date and interval are editable. Starting meter, current meter and status are not. **Bills are not snapshotted for the machine name/number, so old bills (view, PDF, Excel, summary) show the new name** (bills.ts L1080-1106, L1131; billSummary.ts L25, L74). Service due is recomputed live with the new interval. Work history is unaffected (sessions store excavatorId only) | Excavator, AuditLog; displayed bills change | B |
| S7 | Maintenance expense on the wrong machine | No edit | Delete and re-create the expense (expenses.ts has only create and delete). A **service record** on the wrong machine **cannot be edited, moved or deleted** at all (no update/delete exists; FK Restrict). Its cost stays in Profit and its reading may already have raised the wrong machine's meter | ExcavatorExpense (delete+create); ServiceRecord stuck | B |
| S8 | Service reading entered wrong | Not correctable | No edit or delete of ServiceRecord. If the reading was too high, the machine's currentHourMeter was raised to it (serviceRecords.ts L286-290). It can only be lowered indirectly by a later startWork or stopWork with a lower typed meter (set semantics, workSessions.ts L231, L306). The wrong `nextServiceDueHour` drives due/overdue until a newer record (by serviceDate) is added. A wrong future serviceDate makes that record "last" indefinitely | ServiceRecord, Excavator.currentHourMeter | B |
| S9 | Expense recorded twice | Not prevented | No uniqueness or duplicate check (createExpense L37-60; no idempotency key). Both rows count in Profit. The user must delete one manually | ExcavatorExpense ×2 | B |
| S10 | Expense edited/deleted after reporting | Delete only, retroactive | Profit is computed live from current rows (dashboard.ts L921-925). Deleting or re-entering an expense silently changes figures for already-reported past periods. There is no period lock or close. Only the AuditLog keeps the before-image (expenses.ts L67-74), and the AuditLog is not shown in the owner UI (schema L83-87 comment) | ExcavatorExpense, AuditLog | B |
| S11 | Does the Expense total feed dashboard profit? Double count with service cost? | Yes, and double counting is possible | Every type feeds `getProfitOverview` (C5). `maintenanceCost = ServiceRecord.cost + REPAIR/SERVICE/PARTS/TYRES expenses` (L945-947). ServiceRecord and ExcavatorExpense are not linked, so logging the same service bill as a Service record with line costs **and** as a SERVICE/PARTS expense counts it **twice**. The UI gives no warning, and the type "SERVICE" invites exactly this. A DIESEL expense replaces litres×price per machine (no double count there, but see the partial-coverage issue in C5) | — | B |

---------------------------------------------------------------------------------------------------

## 4. Gaps found (functional)

| ID | Gap | Evidence |
|---|---|---|
| G1 | The "SERVICE" (Under Service) status is never set. There is no breakdown or downtime concept, and the dashboard "Under Service" count is always 0 | dashboard.ts L524; no writer (F7) |
| G2 | Archive does not block a WORKING or active-job machine, and does not end the operator assignment, the site, or pending requests. There is no restore | excavators.ts L223-251 |
| G3 | Archived machines still accept startWork, service records, expenses (via API), operator portal jobs and detail-page actions. Only lists hide them | workSessions.ts L49-53, L184; serviceRecords.ts L234; expenses.ts L39; operatorWorkRequests.ts L72-76; workSessions.ts L1061 |
| G4 | Service records cannot be edited or deleted. A wrong reading permanently raises the meter and skews due status | serviceRecords.ts (create only) |
| G5 | Expenses cannot be edited (delete+recreate only), there is no duplicate guard, and the list UI has no filter. The page total only covers the latest 200 | expenses.ts; expenses/page.tsx L28-34 |
| G6 | Double counting is possible between ServiceRecord cost and REPAIR/SERVICE/PARTS/TYRES expenses in Profit | dashboard.ts L945-947 |
| G7 | Component intervals are pre-filled from a guide (contradicting the schema comment). They cannot be edited, and custom components get none. A 50 h component (Greasing, Bucket Teeth) ticked on a full service shortens the *machine's* next service to +50 h, overriding serviceIntervalHrs | serviceRecords.ts L15-71, L247-254; schema L611-615 |
| G8 | Never-serviced components can never trigger a component alert (baseline = current meter) | dashboard.ts L110-113 |
| G9 | No per-machine profitability. Machine Performance shows revenue and hours only. Expenses are not shown on the machine page | siteAnalysis.ts L414-438; detail/page.tsx |
| G10 | OperatorAssignment history is recorded but never shown (`getAssignmentHistoryFor*` unused) | operatorAssignments.ts L162-176 |
| G11 | Reassigning an operator mid-job is not blocked. The job keeps the old operator and the Work tab shows the new one. Archiving an operator does not end the assignment | operatorAssignments.ts L19-101; current-work-tab.tsx L227; operators.ts L278-307 |
| G12 | "Component Status" reads only the latest record, so components serviced earlier show "Never serviced" | service-tab.tsx L126-134; serviceRecords.ts L164-168 |
| G13 | startWork sets the meter to any typed value (it can go backwards). There is no monotonic check | workSessions.ts L213, L229-232 |
| G14 | A site change does not reactivate the new site's status, ignores a running job's site, and operator approval moves the site without asking about the old site's status. A machine can be counted working at 2 sites | excavators.ts L274-297; operatorWorkRequests.ts L463; siteAnalysis.ts L626-627 |
| G15 | Machine name and number are not snapshotted on bills, so edits rewrite old bill displays | schema L789-800; bills.ts L1080-1106 |
| G16 | No owned vs rented, purchase cost, depreciation, transfer between businesses, or retirement/sale record. Archive is the only end-of-life | schema Excavator L184-224 |
| G17 | Direct-bill revenue uses `totalAmount` (with GST) in Machine Performance but `subtotal` in Profit (D) | siteAnalysis.ts L361, L403; dashboard.ts L908 |
| G18 | `approveWorkRequest` sets IDLE even when another operator request on the same machine is still ACTIVE (D) | operatorWorkRequests.ts L60-63, L461-464 |
| G19 | No uniqueness check on machine name or machineNumber | excavators.ts L74-107 |
| G20 | Diesel costing per machine is all-or-nothing: one DIESEL expense in the period disables litres×price for that machine | dashboard.ts L960-968 |
| G21 | The Service dialog has no record-level notes or service type, although the schema supports both | add-service-dialog.tsx L100-104; schema L635 |
| G22 | The bell picks the "last service" without a same-date tiebreak, unlike the machine page (D) | dashboard.ts L155 vs excavators.ts L33 |

---------------------------------------------------------------------------------------------------

## 5. Evidence index

- **prisma/schema.prisma:** Business L19-86 (L31-32 maintenance defaults); Excavator L184-224; OperatorAssignment L227-247; Site L249-279; WorkSession L411-460; OperatorWorkRequest L462-506; ServiceItem L611-628; ServiceRecord L630-648; ServiceRecordItem L650-675; ExcavatorExpense L673-698; Bill L716-787; BillItem L789-813.
- **src/lib/services/excavators.ts:** getMaintenanceSettings L12-17; listExcavators L19-72; createExcavator L74-107; getExcavatorDetail L109-178; updateExcavator L183-219; archiveExcavator L223-251; setExcavatorSite L256-310; listExcavatorOptions L312-325; reorderExcavators L332-355; excavatorInBusiness L360-362.
- **src/lib/validation/excavator.ts:** addExcavatorSchema L11-19; editExcavatorSchema L25-27; setExcavatorSiteSchema L31-36; machineEarningsQuerySchema L41-48.
- **src/lib/services/serviceStatus.ts:** computeServiceStatus L21-34.
- **src/lib/services/serviceRecords.ts:** GUIDE_INTERVAL_HOURS L15-71; DEFAULT_COMPONENT_LIBRARY L73-125; seedDefaultComponents L127-137; listComponentCatalog L139-152; createCustomComponent L154-158; getPreviousServiceSummary L163-184; getComponentHistory L190-197; getReplacementHistory L199-209; listServiceHistory L211-218; createServiceRecord L227-307.
- **src/lib/validation/serviceRecord.ts:** COMPONENT_CATEGORIES L4-13; SERVICE_ACTIONS L15-26; NOT_ACTIONED L28; addComponentSchema L30-33; item row L37-46; createServiceRecordSchema L48-54.
- **src/lib/services/expenses.ts:** listExpenses L15-35; createExpense L37-60; deleteExpense L62-77.
- **src/lib/validation/expense.ts:** EXPENSE_TYPES L3; labels L4-12; createExpenseSchema L20-26; expenseListQuerySchema L30-34.
- **src/lib/services/operatorAssignments.ts:** assignOperator L19-101; endOperatorAssignment L103-160; getAssignmentHistoryForExcavator/Operator L162-176 (unused).
- **src/lib/services/workSessions.ts:** roundHours L31-33; lockOwnedExcavator L49-53; syncExcavatorMeter L94-114; startWork L180-249; stopWork L251-325; deleteWorkSession L998-1037; getOperatorPortalState L1044-1072; listWorkHistory L1106-1141.
- **src/lib/services/operatorWorkRequests.ts:** startOperatorWork L64-125; approveWorkRequest L389-489; rejectWorkRequest L494-.
- **src/lib/services/dashboard.ts:** getComponentMaintenanceAlerts L76-132; getAlerts L139-227; fleet cards L519-524; getProfitOverview L879-1016.
- **src/lib/services/siteAnalysis.ts:** header L55-57; getMachineEarnings L330-439; getDieselLitresByMachine L563-570; getMachinesWorkingBySite L611-636; getFleetBySite L650-684.
- **src/lib/services/sites.ts:** listSiteOptions L9-15; findOrCreateSite L27-34. **src/lib/validation/site.ts:** SITE_STATUSES L6-13.
- **src/lib/services/operators.ts:** archiveOperator L278-307; listOperatorOptions L846-853. **src/lib/services/auth.ts:** catalog seeding L81-87. **src/lib/services/bills.ts:** getBillDetail L1075-1131; listBillsForExport L1026-1027. **src/lib/services/billSummary.ts** L25, L74.
- **src/lib/validation/settings.ts** L9-10; **src/lib/services/settings.ts** updateBusinessProfile L96-117.
- **API routes:**
  - src/app/api/excavators/route.ts (GET/POST)
  - [id]/route.ts (GET/PATCH/DELETE)
  - [id]/assign-operator/route.ts
  - [id]/site/route.ts
  - [id]/start-work/route.ts
  - [id]/stop-work/route.ts
  - [id]/service-records/route.ts
  - [id]/service-tab/route.ts
  - [id]/components/[componentId]/route.ts
  - [id]/work-history/route.ts
  - [id]/daily-logs/route.ts
  - performance/route.ts
  - reorder/route.ts
  - src/app/api/service-items/route.ts
  - src/app/api/settings/service-interval/route.ts
  - src/app/api/expenses/route.ts and [id]/route.ts
- **UI:**
  - src/app/(app)/excavators/page.tsx and reorder-machines.tsx
  - new/add-excavator-form.tsx
  - detail/page.tsx
  - detail/edit/edit-excavator-form.tsx and detail/delete-excavator-button.tsx
  - detail/site-card.tsx
  - detail/assign-operator-dialog.tsx, assigned-operator-card.tsx, end-operator-assignment-button.tsx
  - detail/current-work-tab.tsx, start-work-dialog.tsx, stop-work-dialog.tsx
  - detail/service-tab.tsx, add-service-dialog.tsx, component/page.tsx
  - detail/work-history-tab.tsx
  - src/app/(app)/expenses/page.tsx
  - src/components/machine-card.tsx, machine-performance-list.tsx, status-badge.tsx L7
  - src/components/shell/nav-items.ts L12
- **Not verified (E):** runtime behaviour, data in the remote DB, and the Android app. I could not inspect the recent commit "Site status on machine moves": the folder is not a git repository. I documented its effect from the current code instead (excavators.ts L271-292; site-card.tsx L38-55, L172-197).
