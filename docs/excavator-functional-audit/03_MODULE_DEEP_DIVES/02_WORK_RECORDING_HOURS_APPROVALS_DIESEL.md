# Module deep dive — Daily Work Recording, Hour Meter, Approvals, Operator Portal and Diesel

**Modules covered:**
- Work (jobs) on the machine page: Start Work, Stop Work, Add Daily Log, edit and delete readings, edit and delete jobs, work history
- Operator portal (`/operator`): Submit Reading, Diesel only, Start / End / Edit Work
- Approvals (`/operators/approvals`)
- Diesel Checker (`/diesel-checker`)
- The diesel data captured on work records

## Module summary (business outcome)

**A "job" (Work Session)** is one stretch of work by one machine for one customer at one site. It records:
- an opening meter and date;
- daily **readings**, either meter start/end or clock start/stop minus a break;
- diesel filled and diesel left in the tank;
- a closing meter and date.

**Hours** are always calculated by the app, never typed. The value of the work comes later, from the site's hourly rate or from a bill.

**Two ways work enters the system:**
1. **Owner-entered.** Start, readings and stop are approved immediately.
2. **Operator-entered from the portal.** It stays pending until the owner approves it:
   - readings on an owner-started job are approved one by one;
   - a whole operator-started job is approved by picking its customer and site.

   Only approved work moves the machine meter, the job hours, the reports and billing.

**Diesel** is recorded only as litres filled and litres left in the tank, attached to work records. There is no fuel purchase, stock or supplier ledger.

## Reconciliation notes (main investigator)

| Claim | Verified how | Result |
|---|---|---|
| Approving an older operator job forces machine IDLE + overwrites meter | `operatorWorkRequests.ts` L461-464 read directly | **Confirmed** |
| Work counts as "billed" only when a BillItem links to it | `siteAnalysis.ts` entriesCte `LEFT JOIN "BillItem" bi ON bi."workSessionId"` L164; `getCustomerUnbilledWork` filters `NOT v.billed` | **Confirmed** |
| Site Analysis drops session-level hours once any daily log exists (G1 below) | Stated by investigator from SQL at `siteAnalysis.ts` L124; not independently re-run | Kept at **C/D** — treat as a strong lead, not a fact |

> **How to read this deep dive.** Each feature (F-number) follows the Part 5 deconstruction standard in compressed form:
> *Who / Entry point* = 5.1–5.2 · *Field table* = 5.3 · *Behaviour / Checks* = 5.4 · *Calculations register* = 5.5 · *Connected modules* = 5.6 · *Status tables* = 5.7 · *Historical impact* = 5.8 · *Limitations / Gaps* = 5.10.
> Business outcome (5.9) is stated in the module summary at the top.
> Evidence grades: **A** runtime-verified (none in this audit — no application was run), **B** traced end to end through the code, **C** partly traced, **D** inferred, **E** unverified.
> Paths are relative to `excavator-manager/`. Function names are the authoritative reference; line numbers are as read on 2026-11-24 and may drift.

Main sources:
- `src/lib/services/workSessions.ts` (WS)
- `src/lib/services/operatorWorkRequests.ts` (OWR)
- `src/lib/validation/workSession.ts` (VWS)
- `src/lib/validation/operatorWorkRequest.ts` (VOWR)
- `src/lib/utils/hours.ts`
- `src/lib/attachments.ts`
- `prisma/schema.prisma`
- `src/lib/services/siteAnalysis.ts` (SA)
- `src/lib/services/dashboard.ts`

---

## 0. Data model, as stored

### WorkSession (`prisma/schema.prisma` 411-460)

| Field | Meaning / notes |
|---|---|
| businessId, excavatorId, customerId, siteId, operatorId | All required (non-null). A job cannot exist without a customer, site and operator. FKs use `onDelete: Restrict` (schema 432-435). |
| startDate / endDate | DateTime. endDate is null while ACTIVE. |
| startHourMeter / endHourMeter | Float. endHourMeter is null while ACTIVE. |
| totalHours | Float, default 0. Either the sum of approved WORK readings or the meter difference (see §3). |
| attachment | Tool in use: "Bucket" / "Breaker" / "Chaining" (free string in the DB). |
| dieselLiters | Accumulated diesel filled during the job. |
| remainingDieselLiters | Closing tank balance (litres). |
| dieselDate | Date of the last diesel fill. |
| status | "ACTIVE" or "COMPLETED". Plain string; no DB CHECK constraint found. |
| notes, submittedAt | `submittedAt` is only set for operator-originated work (OWR approval). |
| version | Optimistic-concurrency counter. |
| Relations | dailyLogs, billItems, operatorWorkRequest |

### OperatorWorkRequest (`prisma/schema.prisma` 462-506)

- Fields: excavatorId, operatorId, startDate, startHourMeter, endDate?, endHourMeter?, attachment?, siteName? (free text), dieselLiters?, dieselDate?, notes?, status (ACTIVE / PENDING / APPROVED / REJECTED), rejectionNote?, workSessionId? (unique), submittedAt?, reviewedAt?.
- **There is no customerId and no remainingDieselLiters column.**

### DailyWorkLog (`prisma/schema.prisma` 508-562)

- Fields: workSessionId, date, startTime?, stopTime? ("HH:MM"), breakMinutes?, startHourMeter?, endHourMeter?, hoursWorked (Float, server-computed), operatorName? (free text, admin only), dieselLiters?, remainingDieselLiters?, notes?, attachment?, kind ("WORK" / "DIESEL_ONLY", CHECK constraint `DailyWorkLog_kind_check` in `prisma/migrations/20261008100000_working_periods_site_analysis/migration.sql:116`), source ("ADMIN" / "OPERATOR"), status ("APPROVED" / "PENDING" / "REJECTED"), reviewedAt, version.
- **There is no operatorId**: the person who submitted a reading is recorded only in the AuditLog actor.
- Unique partial index `DailyWorkLog_session_date_live_key` on (workSessionId, date) WHERE status IN ('APPROVED','PENDING') (`prisma/migrations/20261004100000_integrity_indexes/migration.sql:22-24`). This allows one live reading per job per calendar day.

### Excavator (`prisma/schema.prisma` 184-229)

- startingHourMeter, currentHourMeter, status (default "IDLE"; only "WORKING" and "IDLE" are ever written, see `workSessions.ts:231,306,1020` and `operatorWorkRequests.ts:107,463`), currentOperatorId, currentSiteId.
- **No BREAKDOWN or STANDBY status exists.**

### Other diesel-related fields

- `Business.dieselPricePerLitre` Decimal? (schema 57-59).
- `ExcavatorExpense` (schema 677-693): date, type, amount. Type "DIESEL" is one of `EXPENSE_TYPES` (`src/lib/validation/expense.ts:3`). It stores **an amount only: no litres, no supplier, no rate**.

### Attachment values

`ATTACHMENT_VALUES = ["Bucket","Breaker","Chaining"]` (`src/lib/attachments.ts:6`). The error message is `TOOL_REQUIRED_MESSAGE = "Select the tool used (Bucket, Breaker or Chaining)"` (`attachments.ts:10`).

Meaning: the tool fitted on the machine. Site Analysis maps any value containing "bucket" to BUCKET (priced at Site.bucketRate), "breaker"/"brekar" to BREAKER (priced at Site.breakerRate), and anything else (Chaining, empty) to OTHER, which is **unpriced (0 revenue)** (SA header 21-23; CASE at SA 130-133; valuation SA 144-152).

---

## 1. Feature list

### F1. Admin "Start Work" (create an ACTIVE job)

- **Who:** owner / admin (`requireBusinessApi`).
- **Entry point:** Machine detail → Current Work tab, shown when there is no active job and no open OWR (`src/app/(app)/excavators/detail/current-work-tab.tsx:183-205`) → `start-work-dialog.tsx:91` POST `/api/excavators/[id]/start-work` (`route.ts:10-20`) → `startWork` (WS 180-249).
- **Prerequisites:** the machine has an assigned operator (`currentOperatorId`); the customer exists and is not archived; the machine has no ACTIVE WS; the machine has no OWR in ACTIVE or PENDING.

| Field | Required | Meaning | Validation | Default / impact |
|---|---|---|---|---|
| customerId | Y | Billing customer | `min(1)` "Select a customer" (VWS 35); must exist in the business (WS 193-194); must not be archived (WS 196) | Picker; customers can be added inline (`start-work-dialog.tsx:286`) |
| siteName | Y | Site (free text) | trim, `min(1)` "Enter a site" (VWS 36) | `findOrCreateSite` matches case-insensitively by name, otherwise creates a site (`sites.ts:27-34`). Site.customerId is not linked or checked against the job's customer. |
| startDate | Y | Work start day | `dateString` must parse (VWS 7-11). **No future-date check.** | UI defaults to today (`start-work-dialog.tsx:224`) |
| startHourMeter | Y | Opening meter | 0..10,000,000 (VWS 38) | UI default = EXC.currentHourMeter (`start-work-dialog.tsx:237`). **Not compared with the current meter or the previous job's closing.** |
| attachment | server: optional; UI: required | Tool | trim (VWS 39); UI blocks an empty value (`start-work-dialog.tsx:99`) | |
| operatorId | — (never sent) | | | Snapshot of `excavator.currentOperatorId` (WS 221) |

**Behaviour:**
1. Row-locks the EXC (WS 184).
2. Errors:
   - "Machine not found" (404)
   - "Assign an operator to this machine first, from the Machine page." (409, WS 188)
   - "Customer not found"
   - "This customer was removed. Choose another customer." (409)
   - "This machine already has active work. Stop it first." (409, WS 202)
   - "The operator has an in-progress job on this machine — review it first." (409, WS 209)
3. Creates the WS with status ACTIVE and startHourMeter = roundHours(start) (WS 215-227).
4. **Sets EXC.status = WORKING and EXC.currentHourMeter = startHourMeter** (WS 229-232). This happens even when the typed value is lower than the current meter, so the meter moves backwards silently.
5. Writes the audit record `workSession.start` with the meter from/to.

**Limitations:**
- No shift, rate type, hire basis or expected-hours fields.
- No continuity check on the meter.
- No check that the start date is on or after the previous job's end.

### F2. Admin "Stop Work" (ACTIVE → COMPLETED)

- **Entry point:** `stop-work-dialog.tsx:47` → POST `/api/excavators/[id]/stop-work` (`route.ts:7-18`, which pins `excavatorId`) → `stopWork` (WS 251-325).

| Field | Required | Validation | Impact |
|---|---|---|---|
| workSessionId | Y | min 1 | Must be ACTIVE and on the machine in the URL |
| endDate | Y | dateString (VWS 127) | UI default = job start date, `min` = start date (`stop-work-dialog.tsx:101-105`). **The server does not check endDate ≥ startDate.** |
| endHourMeter | Y | 0..1e7 (VWS 128); server requires `> session.startHourMeter` (WS 270-272): "End hour meter must be greater than the starting hour meter" | Sets EXC.currentHourMeter = end (WS 304-307) |
| dieselLiters | N | > 0, ≤ 100,000 (VWS 129) | **Added** to WS.dieselLiters (WS 291-295) |
| remainingDieselLiters | N | ≥ 0 (VWS 130) | **Stored only if dieselLiters is also given** (WS 293). Otherwise ignored. |
| notes | N | trim | Replaces notes only when non-empty (WS 296) |
| expectedVersion | N | int | Stale version → RESOURCE_MODIFIED |

**Behaviour:**
- `totalHours` = the sum of approved WORK readings if there are any; otherwise `calcHoursFromMeter(start, end)` (WS 274-275).
- WS.status becomes COMPLETED; EXC.status becomes IDLE; EXC.meter = end (WS 277-307).
- **The end meter is only compared with the job's start meter, not with the latest reading's end meter.** A final meter below the last daily reading is accepted.
- When readings exist, the hours between the last reading's end and the final meter are **not** added to totalHours.
- PENDING readings stay PENDING after the stop. Approving them later updates the COMPLETED job (see F6).

### F3. Admin "Add Daily Log" (auto-approved WORK reading)

- **Entry point:** `add-daily-log-dialog.tsx:52` → POST `/api/excavators/[id]/daily-logs` → `addDailyLog` (WS 333-411).
- **Prerequisite:** the job is ACTIVE (WS 338-346: "Work session not found or already stopped"). **Readings cannot be added to a COMPLETED job.**

| Field | Required | Validation | Notes |
|---|---|---|---|
| date | Y | dateString (VWS 55) | **No future-date check and no check that the date falls between the job's start and end** |
| startHourMeter / endHourMeter | pair, or time pair | 0..1e7; end > start (VWS 78-79, 84) | UI default start = EXC.currentHourMeter (`add-daily-log-dialog.tsx:41`) |
| startTime / stopTime | pair, or meter pair | `HH:MM` regex (VWS 46-50) | Midnight crossing supported (see §3) |
| breakMinutes | N | int 0..1440 (VWS 60) | Used only in clock mode |
| operatorName | N | free text | Who actually ran the machine that day (schema comment) |
| dieselLiters | N | > 0, ≤ 1e5 | Added to WS.dieselLiters (WS 377-380) |
| remainingDieselLiters | N | ≥ 0 | **Accepted by the API, but the admin UI never sends it** (`add-daily-log-dialog.tsx:66-77`). Stored only when diesel is also given (WS 161-163). |
| attachment | server: optional; UI: required | | Sets WS.attachment (WS 381) |
| notes | N | | |

Schema refine messages:
- "Enter either hour meter readings or start/stop time" (VWS 82)
- "End hour meter must be greater than start hour meter" (VWS 83)

**Behaviour:**
1. Duplicate-day check (WS 348-350): "Hours for this date are already logged — edit or remove that entry first" (409).
2. hoursWorked = `computeHours` (WS 119-129). If both meter and clock values are sent, the meter wins.
3. If `hoursWorked ≤ 0` the request fails with "Working hours must be greater than 0 — check the times or readings" (WS 131, 353).
4. Creates the DWL with source = ADMIN, status = APPROVED, reviewedAt = now (WS 355-364).
5. WS.totalHours = sum of approved WORK readings (WS 371-376).
6. EXC.currentHourMeter is **set** (it can move backwards) to the meter of the job's latest approved WORK reading, ordered by date desc then createdAt desc (WS 385-391, 79-84, 94-114).
   - A back-dated reading does not move the meter unless it is the latest by date.
   - A clock-only latest reading has a null meter (`meterOf` returns null), so nothing moves.
7. Writes the audit record `dailyLog.add`.

### F4. Operator "Submit Reading" (PENDING WORK reading)

- **Who:** operator portal. Shown only when an **admin-started ACTIVE job** exists on the operator's machine (`src/app/(operator)/operator/page.tsx:118-139`).
- **Entry point:** `submit-reading-dialog.tsx:52` → POST `/api/operator/daily-log` → `submitDailyLog` (WS 418-476). Uses `operatorDailyLogSchema` (VWS 91-94).
- **Fields:** the same as F3, except:
  - attachment is **mandatory** and must be one of Bucket / Breaker / Chaining (VWS 91; WS 444-446).
  - operatorName is not sent.
  - remainingDieselLiters is sent ("Diesel left in tank (L)", `submit-reading-dialog.tsx:248-258`).
- **Defaults:** the start meter defaults to `latestEndMeter`, which is the end meter of the newest non-REJECTED reading of the active job (PENDING included), or else EXC.currentHourMeter (WS 1077-1083; `page.tsx:138`). The date defaults to today, with **no `max`** (`submit-reading-dialog.tsx:110`) and no server future check.
- **Checks:**
  - The job must be ACTIVE **and the machine's current operator must be the submitter** (WS 433-441). Otherwise: "No active job found for your assigned machine".
  - Duplicate day: "A reading for this date is already submitted" (409, WS 448-450).
  - hours must be > 0.
- **Creates:** a DWL with source = OPERATOR and status = PENDING (WS 455-462).
- **Does not change** WS.totalHours, WS diesel or the EXC meter until approval (WS 413-417).
- **Operator cannot edit, withdraw or delete a submitted reading.** No endpoint exists; only `/api/operator/{daily-log,diesel,home,language,layout,work/*}` were found.

### F5. Operator "Diesel only" (PENDING DIESEL_ONLY reading)

- **Entry point:** `diesel-only-dialog.tsx:33` → POST `/api/operator/diesel` (idempotency key supported, `route.ts:11-31`) → `submitDieselOnly` (WS 489-568). Shown in both portal modes (`page.tsx:139`, `page.tsx:210`).

| Field | Required | Validation |
|---|---|---|
| dieselLiters | Y | > 0, ≤ 1e5: "Enter the diesel litres (more than 0)" (VWS 99) |
| date | Y | `YYYY-MM-DD`, not in the future (14 h tolerance): "The diesel date can't be in the future" (VWS 101; VOWR 20-22) |
| remainingDieselLiters | N | ≥ 0. Always stored when given (WS 548). |
| attachment | server: optional (VWS 102); UI: required (`diesel-only-dialog.tsx:41-44`) | |
| notes | N | |

**Target job:** the machine's ACTIVE WS; **otherwise its most recent WS of any status**, including COMPLETED and already billed jobs (WS 509-517). If the machine has never had a job: "No previous work found for this machine" (404).

**Errors:**
- "You are not assigned to a machine." (403)
- "A diesel entry for this date is already submitted" (409)
- "A reading for this date already exists — add the diesel to that day's reading instead" (409, WS 524-535)

**Creates:** kind = DIESEL_ONLY, startHourMeter = endHourMeter = EXC.currentHourMeter, hoursWorked = 0, source = OPERATOR, status = PENDING (WS 539-554).

**Consequence:** when the operator works through OWR jobs, a diesel fill on today's job lands on the **previous approved WS**, which may belong to a different customer or site and may already be billed (see Gap G5).

### F6. Admin approve / reject a reading

- **Entry points:**
  - Approvals page (`src/app/(app)/operators/approvals/page.tsx:31-78`, POST `/api/daily-logs/[logId]/approve|reject?expectedVersion=`)
  - The current-work tab buttons (`current-work-tab.tsx:132-149`)
  - Both call `approveDailyLog` (WS 623-691) or `rejectDailyLog` (WS 693-718).
- **Precondition:** status = PENDING. Otherwise "Reading not found or already reviewed" (409). Stale version → RESOURCE_MODIFIED.

**Approve, WORK reading:**
- status → APPROVED; WS.totalHours = sum of approved WORK readings.
- WS.dieselLiters += log litres; WS.dieselDate = log.date.
- WS.attachment = log.attachment (WS 634-657).
- Meter: if the WS is ACTIVE, `set` to the latest approved reading's meter (this can move it backwards). If the WS is COMPLETED, `raise` only (forward-only) to this reading's end meter (WS 662-670).

**Approve, DIESEL_ONLY reading:** only the litres are added and dieselDate is set. Hours, tool and meter are unchanged (WS 644-656, 663-664).

**Reject:** status → REJECTED with reviewedAt. Nothing else changes and **no reason or note is stored** (WS 700-703). The operator can resubmit for the same date because REJECTED rows are outside the unique index.

**Approval UI:** "Submitted by" shows `log.workSession.operator.name`, which is the **job's operator snapshot, not the real submitter** (`approvals/page.tsx:223`).

### F7. Admin edit a reading

- **Entry point:** `edit-reading-button.tsx:56` PATCH `/api/daily-logs/[logId]` → `updateDailyLog` (WS 725-820). Works on any status and any job status, **including billed jobs**.
- **Checks:**
  - If the date changes and another live reading exists on that day: "Another reading already exists for that date" (409, WS 739-742).
  - DIESEL_ONLY needs litres > 0 (WS 747-749).
  - WORK needs hours > 0.
- **WORK reading:** all fields are rewritten through `logData` (WS 763-767). The status stays as it was (a REJECTED reading stays REJECTED). WS.totalHours is re-summed. If the reading is APPROVED, the diesel difference is applied to WS.dieselLiters, the attachment is synced, and the meter is synced only when the job is ACTIVE (WS 772-799).
- **Defect:** the admin edit UI never sends `remainingDieselLiters` (`edit-reading-button.tsx:94-105`), and `logData` writes null unless both diesel and remaining are present (WS 161-163). **Any admin edit of a WORK reading erases its closing-diesel balance.**
- **DIESEL_ONLY entries:** the UI hides Edit (`current-work-tab.tsx:128`; `work-history-tab.tsx:184-199`). Only Delete is offered. The API supports a DIESEL_ONLY edit only when `kind:"DIESEL_ONLY"` is sent (VWS 116-118).
- **UI step:** a confirmation summary of the changes is shown before saving (`edit-reading-button.tsx:107-127`).

### F8. Admin delete a reading

- **Entry point:** `delete-reading-button.tsx:30` DELETE `/api/daily-logs/[logId]` → `deleteDailyLog` (WS 829-897). Any status, **including billed jobs**.
- **Effects:**
  - WS.totalHours is re-summed.
  - For an APPROVED reading, its litres are subtracted from WS.dieselLiters (clamped at ≥ 0, WS 40-41, 850-853).
  - If the job is ACTIVE and the reading was WORK, the meter is set to the latest remaining approved reading, **or rewound to WS.startHourMeter if none remain** (WS 856-863). The attachment follows the latest remaining reading.

### F9. Admin edit a whole job

- **Entry point:** `edit-session-button.tsx:67` PATCH `/api/work-sessions/[id]` → `updateWorkSession` (WS 909-994). Works on ACTIVE or COMPLETED jobs, billed or not.
- **Fields:** customerId (Y), operatorId (Y, any operator of the business), siteName (Y), startDate (Y), endDate (N), startHourMeter (Y), endHourMeter (N), totalHours (N), dieselLiters (N, ≥ 0), attachment, notes (VWS 140-153).
- **Checks:**
  - Customer and operator must exist.
  - The job cannot be moved **to** an archived customer (WS 930-932).
  - endDate < startDate: "End date must be on or after the start date" (WS 934-936).
  - end meter < start meter: "End reading can't be less than the start reading" (WS 939-941). Equal values are allowed and give 0 hours.
- **Hours rule:** sum of approved readings if any exist; else the typed totalHours; else the meter difference; else the existing value (WS 946-949). **When approved readings exist, the typed totalHours is silently ignored.**
- **Diesel:** `dieselLiters` is **overwritten** with the typed value; a blank field gives null (WS 962). This can disagree with the readings it was summed from. remainingDieselLiters is not editable here.
- **Meter sync:** only for a COMPLETED job with an end meter, and only when no WS on the machine has a later startDate (WS 971-978). Uses `set`, so it can move backwards. An ACTIVE job's start-meter edit does **not** move the EXC meter.
- **Billed jobs:** **not locked.** The bill is not rewritten. The audit details record `billed: true` (WS 980-989). The UI's billed warning prop (`edit-session-button.tsx:35,189`) is **never passed by any caller** (a grep for `billed=` returns nothing), so the warning never shows (C).

### F10. Admin delete a job

- `deleteWorkSession` (WS 998-1037).
- Refused if any BillItem references the job: "This work is already on a bill — edit or delete that bill first" (`WORK_SESSION_ALREADY_BILLED`).
- Deletes all of the job's readings and the WS itself.
- If the job was ACTIVE, EXC.status → IDLE, but **the meter is not rewound**.
- A linked OWR keeps status APPROVED with workSessionId set to null (`onDelete: SetNull`, schema 499).
- UI asks `window.confirm` first (`edit-session-button.tsx:152`).

### F11. Operator "Start Work" (OWR ACTIVE)

- **Shown when:** no admin ACTIVE job exists and the operator has no ACTIVE OWR (`page.tsx:203-212`).
- **Path:** `start-work-dialog.tsx` (operator) → POST `/api/operator/work/start` → `startOperatorWork` (OWR 64-126).

| Field | Required | Validation | Default |
|---|---|---|---|
| startHourMeter | Y | ≥ 0 (VOWR 35). **No upper bound** (unlike MAX_HOURS on the admin side). | EXC.currentHourMeter |
| startDate | Y | `YYYY-MM-DD`, not in the future (VOWR 37) | today, `max` = today |
| attachment | Y | enum (VOWR 38) | |
| siteName | N | trim | EXC.currentSite.name (OWR 97) |
| dieselLiters | N | ≥ 0 (**0 is allowed** here, unlike >0 elsewhere) (VOWR 28) | |
| dieselDate | N | free string, **not validated** (VOWR 30) | the work date when litres > 0 (OWR 27-30) |
| remainingDieselLiters | accepted by the schema | | **Discarded: there is no column for it** (OWR 89-103) |
| notes | N | | |

- **Checks:**
  - Operator must be assigned to a machine: "You are not assigned to a machine." (403)
  - An admin ACTIVE WS on the machine blocks it: "Your admin has already started a job on this machine." (409)
  - **No row lock** on the EXC and no check for other open OWRs (OWR 60-63 comment: several open requests may coexist).
- **Side effects:** EXC.status = WORKING and EXC.currentHourMeter = startHourMeter immediately (OWR 105-108), before any approval, despite the schema comment at schema 452-456.

### F12. Operator "End Work" / resubmit (OWR ACTIVE or REJECTED → PENDING)

- POST `/api/operator/work/end` → `endOperatorWork` (OWR 132-187).
- **Fields:** endHourMeter (Y, must be > start: "End hour meter must be greater than the starting hour meter"), endDate (N, defaults to startDate, must be ≥ startDate: "The work end date can't be before the work date", not in the future), attachment (needed only if the request has none).
- **Effects:** status → PENDING; submittedAt = now; rejectionNote and reviewedAt cleared. **The EXC meter and status are not touched**, so the machine stays WORKING.

### F13. Operator edit an OWR (ACTIVE or PENDING)

- POST `/api/operator/work/edit` → `editOperatorWorkRequest` (OWR 195-264).
- **ACTIVE:** start meter, start date, attachment, site, diesel and notes are rewritten, and **EXC.currentHourMeter = new start meter** (OWR 220-228).
- **PENDING:** both meters and both dates can be changed; end must be > start. The request stays PENDING. Nothing official changes.
- **REJECTED:** cannot be edited; it can only be resubmitted through F12.
- Gaps:
  - Blank diesel or site fields are written as null (OWR 212-218).
  - `editOperatorWorkRequestSchema.attachment` is required (VOWR 62).

### F14. Admin approve an OWR (PENDING → APPROVED; creates a COMPLETED WS)

- **Entry points:** Approvals page (`approvals/page.tsx:186-205`) and the machine page (`operator-work-request-card.tsx`) → `approve-work-request-dialog.tsx:74` POST `/api/work-requests/[id]/approve` → `approveWorkRequest` (OWR 389-489).
- **The admin chooses:** an existing customerId or a new customer (name plus optional mobile; the customer is created inline, OWR 408-414). The customer defaults to the customer of the operator's last COMPLETED WS (OWR 343-356; dialog 72).
- **The admin can also correct:** siteName (Y), start and end meters (Y, end > start), start and end dates, attachment (Y), dieselLiters, remainingDieselLiters (new input), dieselDate and notes (VOWR 74-116).
- **Checks:**
  - The request must be PENDING.
  - The customer must belong to the business and not be archived.
  - "Select a customer or add a new one".
  - endDate ≥ startDate.
- **Records created:**
  1. An optional Customer.
  2. An optional Site (`findOrCreateSiteInTx`).
  3. A **WS with status COMPLETED** directly, with totalHours = `calcHoursFromMeter(start, end)`, submittedAt, diesel, and remainingDieselLiters (only when diesel is given) (OWR 434-454).
  4. OWR → APPROVED with workSessionId set.
  5. **EXC.status = IDLE, EXC.currentHourMeter = endHourMeter, EXC.currentSiteId = site** (OWR 461-464). This is unconditional: no forward-only rule and no check for a newer ACTIVE OWR.
- **No DailyWorkLog is created.** The job counts in analysis as a single session-level entry.
- **Not checked:** overlap with other jobs; continuity with the previous closing meter.

### F15. Admin reject an OWR (PENDING → REJECTED)

- `rejectWorkRequest` (OWR 494-524).
- Takes an optional note, stored as rejectionNote and shown to the operator (`page.tsx:232-234`).
- **The EXC stays WORKING** with the start meter.
- An ACTIVE OWR cannot be rejected, cancelled or deleted by the admin. No endpoint exists; `operatorWorkRequest.delete*` appears only in `support.ts:196`, which wipes a whole business.

### F16. Operator portal home

- GET `/api/operator/home` (`route.ts:15-39`) → `getOperatorPortalState` (WS 1044-1086).
- The machine is taken from the newest ACTIVE OperatorAssignment, falling back to `currentOperatorId`.
- **Mode A:** an admin ACTIVE job exists. The portal shows the job's customer and site and offers Submit Reading plus Diesel only. The reading list includes ADMIN-sourced readings, badged "ADMIN" (`page.tsx:148-176`).
- **Mode B:** no admin job. The portal shows open OWRs (ACTIVE / PENDING / REJECTED) plus 31 days of history (at most 60 rows each), merging the operator's own OWRs with admin jobs recorded under their name (OWR 270-329; `route.ts:25-36`).

### F17. Approvals queue (admin)

- GET `/api/approvals` returns pending readings (at most 500, oldest first), PENDING OWRs, customer options and join requests (`api/approvals/route.ts:8-21`; WS 570-590; OWR 333-357).
- The page polls every 10 s (`approvals/page.tsx:86-90`).
- Display bug: `formatHours()` already appends "hrs", and the card adds " hrs worked" after it, so it reads "X hrs hrs worked" (`approvals/page.tsx:141`, `hours.ts:25-27`).

### F18. Work history (admin)

- GET `/api/excavators/[id]/work-history` with filters customerId, operatorId, site (contains, case-insensitive), from/to on startDate, and a cursor (WS 1106-1141).
- The history tab allows editing the job, editing readings (WORK only) and deleting readings (`work-history-tab.tsx:130-205`).

### F19. Diesel Checker (owner)

- Page `src/app/(app)/diesel-checker/page.tsx`.
- A **pure client-side calculator**: nothing is saved or read from the DB (`diesel-checker-form.tsx:9-29`).
- Inputs: Total Hours, Total Diesel Taken (L), and Remaining Diesel in Tank (optional). The formula is in §3.

### F20. Diesel price setting and DIESEL expense

- **Diesel price:** PATCH `/api/settings/diesel-price` → `updateDieselPrice` (`settings.ts:190+`). Set from the Settings page (`settings/diesel-price-form.tsx`).
- **Used only by** `getProfitOverview` (`dashboard.ts:950-972`) to cost recorded litres.
- **ExcavatorExpense type DIESEL:** created from the Expenses page / `/api/expenses` (`expenses.ts:37+`). It stores a money amount per machine and date. In the Profit Overview it **replaces** litres × price for that machine in the period (`dashboard.ts:951-969`).
- **Diesel on bills:** the bill's "Diesel supplied by customer" deduction uses the selected jobs' `WS.dieselLiters` summed in the browser, multiplied by a per-bill typed rate (`generate-bill-form.tsx:116,130,140`). It **does not default from `dieselPricePerLitre`** (a grep finds no use of it in the bill code).

### F21. Site Analysis diesel and hours (read-only reporting)

`entriesCte` (SA 97-191) is the single source of figures. Readings tables, diesel entries and averages: `listDailyReadings` (SA 1163-1255), `listDieselEntries` (SA 1257-1297), `getSiteAnalysis` diesel block (SA 961-971), `getDieselConsumptionStats` (SA 990-1005). Formulas are in §3.

---

## 2. State-transition tables

### WorkSession

| From | Event | To | Function | Side effects |
|---|---|---|---|---|
| — | Admin Start Work | ACTIVE | startWork WS 215-232 | EXC WORKING, meter = start |
| — | Admin approves an OWR | **COMPLETED** (never ACTIVE) | approveWorkRequest OWR 434-464 | EXC IDLE, meter = end, currentSite = site |
| ACTIVE | Admin Stop Work | COMPLETED | stopWork WS 277-307 | EXC IDLE, meter = end |
| ACTIVE / COMPLETED | Admin edit | same status | updateWorkSession | Meter sync only if COMPLETED and latest job |
| ACTIVE / COMPLETED (unbilled) | Admin delete | deleted (with readings) | deleteWorkSession | EXC IDLE if it was ACTIVE; meter not rewound |
| COMPLETED | — | ACTIVE | **No reopen path exists** | |
| COMPLETED | Bill generated | (no status change) | bills.ts 423-435 bills only COMPLETED jobs with no BillItem | One BillItem per job (unique index, `migration 20261004091000:151`) |

There is no "BILLED" or "LOCKED" status. Billing is derived from the BillItem's existence.

### DailyWorkLog

| From | Event | To | Who |
|---|---|---|---|
| — | addDailyLog | APPROVED (source ADMIN, kind WORK) | admin |
| — | submitDailyLog | PENDING (OPERATOR, WORK) | operator |
| — | submitDieselOnly | PENDING (OPERATOR, DIESEL_ONLY) | operator |
| PENDING | approveDailyLog | APPROVED | admin |
| PENDING | rejectDailyLog | REJECTED | admin |
| any | updateDailyLog | **unchanged** (no re-approve and no un-approve) | admin |
| any | deleteDailyLog | deleted | admin |
| APPROVED / REJECTED | approve or reject | blocked with 409 "already reviewed" | |
| REJECTED | operator resubmits | a new PENDING row (the old one is kept) | operator |

### OperatorWorkRequest

| From | Event | To | Function |
|---|---|---|---|
| — | Operator Start | ACTIVE | startOperatorWork |
| ACTIVE | Operator edit | ACTIVE (EXC meter = new start) | editOperatorWorkRequest |
| ACTIVE | Operator End | PENDING | endOperatorWork |
| PENDING | Operator edit | PENDING | editOperatorWorkRequest |
| PENDING | Admin Approve | APPROVED (+ COMPLETED WS) | approveWorkRequest |
| PENDING | Admin Reject | REJECTED | rejectWorkRequest |
| REJECTED | Operator resubmit (End) | PENDING | endOperatorWork |
| ACTIVE | Admin cancel / delete | **not possible** | — |
| APPROVED | — | terminal. If its WS is deleted, the request stays APPROVED with workSessionId null. | |

### Excavator.status

Only IDLE and WORKING exist.

- **WORKING** is set by startWork and startOperatorWork.
- **IDLE** is set by stopWork, approveWorkRequest and deleteWorkSession (ACTIVE job).
- After an OWR is rejected the machine stays WORKING.

---

## 3. Calculations register

| # | Name | Exact formula (code) | Location |
|---|---|---|---|
| C1 | Hours from meter | `round(end − start, 2)` using `Math.round(h*100)/100` | hours.ts 8-11 |
| C2 | Hours from clock | `start = H*60+M`; `stop = H*60+M`; if `stop < start` then `stop += 1440`; `hours = round((stop − start − breakMinutes)/60, 2)` | hours.ts 14-23 |
| C3 | Reading hoursWorked | If both meters are present: C1 on meters already rounded with `roundHours` (ROUND_HALF_UP, 2 dp). Otherwise C2 with break defaulting to 0. Must be > 0. | WS 119-131, 31-33 |
| C4 | WS.totalHours (admin job) | If approved WORK readings exist: Σ hoursWorked (exact decimal sum, then 2 dp). Otherwise at stop: C1(start, end). | WS 70-76, 274-275 |
| C5 | WS.totalHours (from OWR) | C1(admin-corrected start, end) | OWR 422-424 |
| C6 | WS.totalHours (admin edit) | approved readings → Σ; else typed totalHours; else C1(start, end); else unchanged | WS 946-949 |
| C7 | WS.dieselLiters accumulation | `+=` reading litres on admin add or on approval; `+=` stop-work litres; edit applies the difference (clamped ≥ 0); delete subtracts (clamped ≥ 0); **job edit overwrites** | WS 38-41, 291-295, 377-380, 651-654, 780-783, 850-853, 962 |
| C8 | EXC.currentHourMeter | Start sets it to the start meter. Stop / OWR approve set it to the end meter. Readings: `set` to the latest approved WORK reading's (end ?? start) when the job is ACTIVE; `raise` (forward only) when COMPLETED. Deleting the last reading rewinds to WS.start. OWR start / edit set it to the start meter. | WS 94-114, 231, 306, 385-391, 662-670, 856-863; OWR 105-108, 225-228, 461-464 |
| C9 | Default opening for the next operator reading | End meter of the newest (by date) non-REJECTED reading of the active job, else EXC.currentHourMeter. **This is a UI default only; it is not enforced.** | WS 1077-1083 |
| C10 | Per-entry diesel consumed and average (Site Analysis) | `available = (prevClosing ?? 0) + filled`; `consumed = round2(available − closing)`; `average = consumed / hours`. Returns null if there is no closing, or if there is no prevClosing and filled ≤ 0. `consumed < 0` → flagged, average null. `hours ≤ 0` → average null. Here "hours" is the row's meter hours (end−start, else recorded hours) aggregated per (day, machine, site); `prevClosing` is the latest earlier day's closing **for the same machine at the same site**. | SA 1050-1063, 1128-1150, 1209-1231 |
| C11 | Simple diesel average | `L/hr = diesel / hours`; `hr/L = hours / diesel` (null when either is ≤ 0) | SA 1087-1095 |
| C12 | Site exact rate | For each machine with a latest closing in the window: `consumed += Σ filled − latestClosing`; `rate = Σ consumed / Σ hours`, null if ≤ 0. **This assumes the opening tank was 0 at the start of the window.** | SA 1104-1124 |
| C13 | Totals averages | `avgDieselPerDay = diesel / distinct days with any entry`; `avgDieselPerHour = diesel / hours`; `avgHoursPerDay = hours / days with hours > 0` | SA 243-273 |
| C14 | Predicted hours left | `closingDiesel / average` | SA 1003 |
| C15 | Diesel Checker | `consumed = remaining given ? max(0, taken − remaining) : taken`; `avg = round2(consumed / hours)`; `hoursLeft = round2(remaining / avg)` | diesel-checker-form.tsx 14-29 |
| C16 | Profit diesel cost per machine | If DIESEL expenses exist in the period: Σ amount. Else if litres > 0 and a price is set: litres × dieselPricePerLitre. Else uncosted ("no-price"). Litres come from approved entries via `getDieselLitresByMachine` (SA 563-570). | dashboard.ts 950-972 |
| C17 | Unbilled revenue per entry | `hours × rate(type, rate history on the work date)`. OTHER (including Chaining) = 0. **Hourly rates only.** | SA 144-152, 166-174 |
| C18 | Bill line | `hours = round2(WS.totalHours)`; `amount = hours × ratePerHour` | bills.ts 463-466 |
| C19 | Live preview | The UI calls the same C1 / C2 and shows "—" when the result is ≤ 0 | work-total-hours.tsx 21-41; hours-worked-preview.tsx |

**Rounding inconsistency:**
- `roundHours` uses Decimal ROUND_HALF_UP (WS 26-33).
- `calcHoursFromMeter` / `calcHoursFromClock` and the OWR `r2` use float `Math.round(x*100)/100` (hours.ts 10, 22; OWR 19).
- Edge values such as 1.005 can round differently (D).
- Units are decimal hours; the UI step is 0.1 and the server keeps 2 dp. There is no hh:mm meter format.

**Hire basis:** only hourly. No daily, shift or monthly hire; no minimum hours; no standby, idle, breakdown or overtime; no split between billable and actual hours. A grep finds no such fields in the schema or services. The only "hours" are recorded hours (Site Analysis "readingDifference" = meter hours − Bucket − Breaker hours, SA 1252).

---

## 4. Scenario answers

| # | Scenario | Supported? | Actual behaviour | Records affected | Ev. |
|---|---|---|---|---|---|
| S1 | Operator forgets a reading | Partly | There is no reminder or missing-day detection. Admin can add a reading later (job must be ACTIVE) and operator can back-date one. If the job is already COMPLETED, no reading can be added (WS 338-346); the admin can only edit job totals (and if the job has approved readings, the typed totalHours is ignored, WS 947). If no readings exist at all, stopWork uses the meter difference, which covers missed days. | DWL; WS.totalHours | B |
| S2 | Work across midnight | Yes | Clock mode adds 24 h when stop < start (hours.ts 19). One reading carries one date only, so the hours land on the start date. Meter mode is unaffected. OWRs have separate start and end dates. | DWL.hoursWorked | B |
| S3 | Site change during a day | No (per job) | A job has one siteId. Changing site needs Stop plus a new Start (a second job), or a job edit that moves **all** hours to the new site. Readings carry no site. The admin can set the machine site directly (excavators.ts 256-310), but that does not touch the job. | WS.siteId | B |
| S4 | Two operators, same machine, different shifts | No | Only one currentOperatorId per machine. A job has one operatorId. Only one live reading per job per day (unique index). Only the currently assigned operator can submit (WS 438). The second shift must be merged into one reading; the admin can type a free-text operatorName (one name). Readings have no operatorId field. | — | B |
| S5 | Meter replaced / reset | No dedicated flow | `startingHourMeter` cannot be edited after creation (`validation/excavator.ts:23-27`, updateExcavator does not write it) and there is no direct currentHourMeter edit. A workaround exists: Start Work with a lower start meter **silently rewinds** EXC.currentHourMeter (WS 231). No meter-change event or offset is recorded, so service-due maths would be distorted (D). | EXC.currentHourMeter | C |
| S6 | Partial shift | Yes (as hours) | Clock mode with breakMinutes, or a meter difference. There is no shift concept or minimum-billing logic. | DWL | B |
| S7 | Breakdown during work | No | There is no breakdown status, downtime record or breakdown-hours field. The only option is a note. The EXC status set is {IDLE, WORKING}. Service records are a separate module (not audited here). | — | B |
| S8 | Missing entry (gap day) | Not detected | Nothing validates consecutive days or meter continuity. The Site Analysis per-day diesel average uses the previous closing on any earlier day (SA 1201-1208), so a gap merges silently. | — | B |
| S9 | Incorrect opening / closing | Partly | Server checks: end > start within a reading (VWS 78-79), stop end > job start (WS 270), OWR end > start. **Not checked:** opening = previous closing, a reading inside the job range, stop end ≥ last reading end, start meter ≥ machine meter. Corrections go through admin edit (F7/F9) or operator edit before approval (F13). Site Analysis flags stored end < start (SA 1196). | DWL, WS, EXC | B |
| S10 | Duplicate reading | Blocked per job per day | Service check plus the unique partial index (APPROVED / PENDING). Messages: "Hours for this date are already logged…" (admin), "A reading for this date is already submitted" (operator). A rejected row does not block. **The same meter range on different dates is not detected.** OWRs have no duplicate or overlap check: several OWRs with overlapping meters can be approved. | DWL | B |
| S11 | Late / back-dated reading | Yes | Admin and operator readings: any parseable date; **future dates allowed** (dateString only, VWS 7-11, 55; operator date input has no max, submit-reading-dialog 110). OWR and diesel-only dates: no future (14 h tolerance), any past. A back-dated reading does not move the meter unless it is the latest by date. On a COMPLETED job, approval only raises the meter. | DWL, EXC | B |
| S12 | Hours corrected after invoicing | Allowed, not locked | updateWorkSession, updateDailyLog, deleteDailyLog and approveDailyLog have **no billed check**. WS.totalHours and diesel change; BillItem keeps its snapshot (hours, rate, amount; bills.ts 498-509). Only job **delete** is blocked when billed (WS 1010-1013). The audit records `billed`. Billed revenue in Site Analysis stays the BillItem amount spread over entries, while hours shown come from the edited readings, so hours and revenue diverge (SA 176-190). The UI billed warning is never wired (F9). | WS, DWL (BillItem unchanged) | B |
| S13 | Multiple diesel entries in one day | Limited | One live DWL per job per day, so a second same-day diesel-only entry gets 409 "A diesel entry for this date is already submitted". A diesel-only entry on a day that already has a WORK reading gets 409 "…add the diesel to that day's reading instead" (WS 528-535). One reading holds a single dieselLiters value, so two fills must be summed manually. Stop-work and OWR diesel are separate fields that are added to WS.dieselLiters. | DWL, WS | B |
| S14 | Wrong diesel quantity / wrong machine | Quantity: yes. Machine: no. | Admin edits litres on a WORK reading (the difference is applied to WS) or on a job (overwrite). For a diesel-only entry: delete only (UI). There is **no "move to another machine"**; the entry must be deleted and re-entered, and an operator can only enter for their own assigned machine. | DWL, WS | B |
| S15 | Diesel without a working record | Partly | A diesel-only entry needs an existing job on the machine; otherwise 404 "No previous work found for this machine". When there is no ACTIVE job it is attached to the most recent job of any status (possibly COMPLETED or billed, another customer or site). **The admin UI has no diesel-only entry**; the admin path needs hours > 0 or a job stop. There is no standalone diesel / fuel ledger. | DWL on the previous WS | B |
| S16 | Fuel balance negative | Prevented in inputs, flagged in reports | remainingDieselLiters ≥ 0 (VWS 63, 100). WS.dieselLiters is clamped ≥ 0 on subtraction. If prevClosing + filled − closing < 0, `dieselFlagged` = true and average = null (SA 1060). There is no tank-capacity field and no running stock. | — | B |
| S17 | Hours recorded without a job / customer / site | Admin: no. Operator: temporarily. | WS requires customer, site and operator (schema). A DWL requires a WS. An operator OWR (ACTIVE / PENDING) records hours with no customer and moves the EXC meter at start, but becomes billable work only when the admin approves and picks a customer and site. Unapproved OWR hours appear in no report (only WS and DWL are read by SA). | OWR, EXC | B |
| S18 | Operator leaves mid-job / is replaced | Partly | Reassigning the operator does not touch the ACTIVE job (operatorAssignments.ts 19-101). WS.operatorId stays the old snapshot until the admin edits the job (WS 955). The new operator can submit readings (ownership uses currentOperatorId, WS 438) but they are attributed to the job's operatorId. In Site Analysis the operator name is DWL.operatorName (admin only) or else WS.operator (SA 139). For an OWR: the old operator's ACTIVE request stays tied to them. The new operator's portal sees no ACTIVE OWR of their own, so Start Work appears and they could start a second OWR on the machine (listOpenOperatorRequests filters by operatorId, OWR 270-275). The old request cannot be cancelled by the admin and blocks admin Start Work (WS 204-210). There is no per-day operator split within a job. | WS.operatorId, OWR | C |
| S19 | Operator starts a new OWR while the previous one is PENDING, then admin approves the old one | Bug | approveWorkRequest sets EXC.status = IDLE and the meter to the old end, unconditionally (OWR 461-464), while the new OWR is still running. The meter rewinds and the status is wrong. | EXC | B |
| S20 | Pending readings at stop time | Allowed | stopWork ignores pending readings (counts approved only, WS 274-275). A later approval on the COMPLETED job re-sums totalHours (WS 649) and raises the meter. If billed in between, the bill is not updated. | WS, EXC | B |

---

## 5. Gaps / defects (business impact)

- **G1. Site Analysis loses hours and diesel for jobs that have any non-counting reading.**
  - The SESSION branch requires `NOT EXISTS` any DWL for the job, with no status or kind filter (SA 124). The LOG branch counts only APPROVED readings and gives DIESEL_ONLY 0 hours (SA 106, 114).
  - (a) A job approved from an OWR (no readings) that later receives a diesel-only entry, **even one still PENDING**, drops its whole totalHours and job-level diesel from Site Analysis, unbilled revenue, `getRecordedHoursForBilling`, `getWorkTotals` (profit) and `getDieselLitresByMachine`.
  - (b) An admin job whose readings were all rejected or left pending, then stopped with meter-difference hours, shows 0 in analysis but bills its full hours (bills use WS.totalHours).
  - (c) Stop-work diesel (session-level) on a job that has readings is never counted in analysis.
  - Evidence D/C (SQL traced; no runtime test).
- **G2. Billed work is editable.** Hours, diesel, customer, site, operator and readings can all change after invoicing. There is no lock and no re-bill prompt, and the billed warning UI is not wired (F9, S12).
- **G3. No meter-continuity rules.**
  - Opening ≠ previous closing is accepted.
  - Stop end below the last reading is accepted.
  - Start Work with a lower meter rewinds the machine meter.
  - OWR approval sets the meter backwards unconditionally (C8, S19).
- **G4. The admin edit of a reading erases remainingDieselLiters** (F7). Admin add cannot capture it. A closing balance is stored only when litres are filled on the same entry (WS 161-163, 293; OWR 449). Diesel-only entries are the exception.
- **G5. Diesel-only entries attach to the "most recent job of any status"** (WS 509-517). This can be a COMPLETED, billed job of another customer. Approval then raises that job's dieselLiters after billing.
- **G6. No diesel purchase or stock ledger.**
  - No supplier, invoice, rate per litre or tank-capacity fields.
  - No opening or closing stock and no issue-vs-purchase reconciliation.
  - `ExcavatorExpense` type DIESEL holds an amount only (validation/expense.ts 3, 20-26) and is used only by the Profit Overview (dashboard.ts 951-969).
  - `Business.dieselPricePerLitre` is used only to cost litres in the Profit Overview. It is not used on bills (the bill diesel rate is typed each time).
  - The Diesel Checker is a calculator with no persistence.
- **G7. Missing operational concepts.** No shift; no standby, idle or breakdown time or status; no overtime; no billable vs actual hours; no daily, monthly or minimum-hire basis (only hourly Bucket / Breaker rates; Chaining is unpriced, C17).
- **G8. Readings cannot carry a different operator or site.** There is one reading per job per day. Two-shift operation is not supported (S4). Submitter identity is not stored on the DWL. The approvals card shows the job's operator, not the submitter.
- **G9. Reading dates are unbounded.**
  - Future dates are allowed for admin and operator WORK readings.
  - Admin job dates have no future check.
  - Reading dates are not bounded by the job's start and end.
  - The stop endDate is not checked against startDate on the server.
- **G10. OWR lifecycle holes.**
  - The admin cannot cancel or close an ACTIVE OWR, which then blocks admin Start Work indefinitely.
  - The machine stays WORKING after a reject.
  - startOperatorWork has no lock and no check for other open OWRs.
  - OWR start accepts `remainingDieselLiters` but drops it.
  - `dieselDate` is not validated.
  - The OWR start meter has no upper bound.
- **G11. Rejection of a daily reading has no reason field.** OWR rejection has a note. The operator cannot edit or withdraw pending readings.
- **G12. updateWorkSession overwrites dieselLiters** (a blank field gives null) and ignores the typed totalHours when approved readings exist. The UI does not explain the second behaviour (WS 947, 962).
- **G13. Diesel exact-rate formula (C12) assumes a zero opening tank in the window.** The per-entry formula (C10) ignores intermediate fills on days without a closing. Readings are chained per site, so a machine moving between sites breaks the chain.
- **G14. Rounding mixes Decimal HALF_UP and float rounding** (§3). There is also the "hrs hrs" label (F17).
- **G15. Deleting an ACTIVE job does not restore the machine meter**, and deleting an OWR-born job leaves the request APPROVED with no session.

---

## 6. Evidence index

| Topic | File : lines (function) |
|---|---|
| Hours formulas | src/lib/utils/hours.ts 8-11 (calcHoursFromMeter), 14-23 (calcHoursFromClock), 25-27 (formatHours) |
| Rounding, locks, approvedHours, meter sync, computeHours, dup check, logData | src/lib/services/workSessions.ts 31-41, 49-59, 70-87, 94-114, 119-131, 133-149, 151-167 |
| startWork / stopWork | workSessions.ts 180-249 / 251-325 |
| addDailyLog / submitDailyLog / submitDieselOnly | workSessions.ts 333-411 / 418-476 / 489-568 |
| listPendingLogs / approveDailyLog / rejectDailyLog | workSessions.ts 570-594 / 623-691 / 693-718 |
| updateDailyLog / deleteDailyLog | workSessions.ts 725-820 / 829-897 |
| updateWorkSession / deleteWorkSession | workSessions.ts 909-994 / 998-1037 |
| getOperatorPortalState / listWorkHistory | workSessions.ts 1044-1086 / 1106-1141 |
| OWR start / end / edit | src/lib/services/operatorWorkRequests.ts 64-126 / 132-187 / 195-264 |
| OWR lists / approve / reject / site-analysis readings | operatorWorkRequests.ts 270-374 / 389-489 / 494-524 / 531-570 |
| Validation (admin) | src/lib/validation/workSession.ts 7-11 dateString, 26-27 limits, 33-40 startWork, 46-50 time, 54-66 fields, 75-79 refines, 81-84 dailyLog, 91-94 operator, 98-104 dieselOnly, 110-121 updateDailyLog, 125-133 stopWork, 140-153 updateWorkSession |
| Validation (operator) | src/lib/validation/operatorWorkRequest.ts 6 toolField, 10-22 date / future, 27-32 diesel, 34-41 start, 45-52 end, 56-65 edit, 74-123 approve, 127-133 reject |
| Attachments | src/lib/attachments.ts 6, 10 |
| Schema | prisma/schema.prisma 57-59 (dieselPricePerLitre), 184-229 (Excavator), 411-460 (WorkSession), 462-506 (OWR), 508-562 (DailyWorkLog), 677-693 (ExcavatorExpense) |
| DB constraints | prisma/migrations/20261004100000_integrity_indexes/migration.sql 22-24; 20261004091000_security_and_integrity/migration.sql 151 (BillItem_workSessionId_key); 20261008100000_working_periods_site_analysis/migration.sql 116 (kind check) |
| API routes | src/app/api/excavators/[id]/{start-work,stop-work,daily-logs,work-history}/route.ts; api/daily-logs/[logId]/{route,approve,reject}.ts; api/work-sessions/[id]/route.ts; api/work-requests/[id]/{approve,reject}/route.ts; api/approvals/route.ts; api/operator/{daily-log,diesel,home,work/start,work/end,work/edit}/route.ts |
| Operator UI | src/app/(operator)/operator/page.tsx 116-181 (mode A), 183-362 (mode B); submit-reading-dialog.tsx 41-79, 110, 223-258; start-work-dialog.tsx 45-57, 81-147; end-work-dialog.tsx 50-151; edit-work-dialog.tsx 68-236; diesel-only-dialog.tsx 39-52, 85-132 |
| Owner UI | src/app/(app)/excavators/detail/current-work-tab.tsx 86-149, 170-252; start-work-dialog.tsx 91-246; stop-work-dialog.tsx 20-135; add-daily-log-dialog.tsx 30-77; edit-reading-button.tsx 36-127; delete-reading-button.tsx 30; edit-session-button.tsx 35, 67-157, 189; approve-work-request-dialog.tsx 30-104, 255-330; reject-work-request-dialog.tsx 24; work-history-tab.tsx 130-205; operator-work-request-card.tsx 93-117; operators/approvals/page.tsx 31-78, 86-90, 123-263 |
| Preview components | src/components/work-total-hours.tsx 21-41; src/components/hours-worked-preview.tsx |
| Diesel analytics | src/lib/services/siteAnalysis.ts 14-19, 48-53 (header), 97-191 (entriesCte; 106 diesel-only hours, 124 NOT EXISTS), 227-273 (AGG / toTotals), 516-546 (billing hours), 553-570 (work totals, litres by machine), 961-971 (diesel block), 990-1005 (consumption stats), 1050-1063 (dieselEntryAverage), 1087-1095 (simple), 1104-1124 (consumptionPerHour), 1128-1150 (closingBalances), 1163-1255 (listDailyReadings), 1257-1297 (listDieselEntries) |
| Diesel Checker | src/app/(app)/diesel-checker/diesel-checker-form.tsx 9-114; page.tsx |
| Diesel cost / price / expense | src/lib/services/dashboard.ts 897-972 (getProfitOverview); src/lib/services/expenses.ts 9-13, 37+; src/lib/validation/expense.ts 3-26; src/app/api/settings/diesel-price/route.ts; src/lib/services/settings.ts 190+; src/app/(app)/bills/new/generate-bill-form.tsx 116-140 |
| Billing interplay | src/lib/services/bills.ts 364-391 (unbilled list), 418-510 (createBill: COMPLETED only, hours = WS.totalHours) |
| Operator assignment | src/lib/services/operatorAssignments.ts 19-101 (assign), 103-140 (end) |
| Excavator meter fields | src/lib/services/excavators.ts 82-93 (create), 183-218 (update: no meter fields), 256-310 (setExcavatorSite); src/lib/validation/excavator.ts 23-27 |
