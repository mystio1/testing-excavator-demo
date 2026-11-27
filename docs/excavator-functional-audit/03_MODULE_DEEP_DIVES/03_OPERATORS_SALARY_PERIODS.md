# Module deep dive — Operators, Onboarding, Working Periods, Leave, Money Transactions and Salary

**Modules covered:**
- Operators (`/operators`): list, add, edit, delete (archive), detail tabs Overview, Money, Salary, Sessions and History
- Portal login / PIN
- Operator self-signup and join approvals (`/operator-signup`, `/operators/approvals`)
- Working periods ("Sessions") and leave
- Operator money transactions
- The salary calculations
- Operator ↔ machine assignment, from the operator's side

## Module summary (business outcome)

**Registration.** The owner registers each operator with a name, mobile, optional joining date and a monthly salary. An operator can instead request to join with the business code and their own PIN. The owner then approves the request by typing the 6-digit verification code the operator was shown.

**Salary rules:**
- **Monthly salary only.** Pay accrues day by day over *working periods* (sessions), with no attendance or hours involved.
- **Unpaid leave** inside a period reduces pay.
- **Moving between periods.** Starting a new period after a gap closes the old one, records the gap as leave, and offers to carry any unpaid balance forward.

**Money transactions.** Every money movement between owner and operator is one transaction: advance, expense, salary payment, bonus or other. A "deduct from salary" flag decides whether it reduces pay.

**Outcome.** At any time the owner can see what has been earned, paid and deducted, and what remains owed. The calculation behind that answer differs by screen (see C2–C5 below).

## Reconciliation notes (main investigator)

1. **Line-number correction.** The investigator's line numbers for `src/lib/services/salary.ts` and `src/lib/services/operatorAssignments.ts` do **not** match the files. The function names and the logic described are correct; the main investigator verified `computeSalaryForMonth`, `getTotalSalaryDue` and `isDeduction` directly. Use these corrected locations:

| Function (as cited below) | Cited as | Actual location |
|---|---|---|
| `periodMonthBase` | `sal` L174-194 | `salary.ts` L33-62 |
| `carriedForwardBalance` | `sal` L205-219 | `salary.ts` L64-95 |
| `computeSalaryForMonth` (formula A) | `sal` L238-289 | `salary.ts` L97-148 |
| `getLifetimeSalarySummary` (formula B / C) | `sal` L342-406 | `salary.ts` L201-266 |
| `complexOperators` | — | `salary.ts` L269-289 |
| `getLifetimeSalaryBreakdown` | `sal` L432-475 | `salary.ts` L291-~408 |
| `salaryBreakdownExact` / `getSalaryBreakdownForMonth` | `sal` L487-549 | `getSalaryBreakdownForMonth` `salary.ts` L410-418 (calls `salaryBreakdownExact`) |
| `getTotalSalaryDue` | `sal` L564-576 | `salary.ts` L423-435 |
| `assignOperator` | `oas` L268-350 | `operatorAssignments.ts` L19-101 |
| `endOperatorAssignment` | `oas` L352-409 | `operatorAssignments.ts` L103-160 |
| `getAssignmentHistoryFor*` (unused) | `oas` L411-425 | `operatorAssignments.ts` L162-176 |

   Line numbers for `operators.ts`, `operatorTransactions.ts`, `salaryCore.ts`, `workingPeriods.ts` and `workingPeriodActions.ts` were spot-checked and match.

2. **Formula A verified.** For a "legacy-shape" operator (one ACTIVE period, no leave), `computeSalaryForMonth` uses the constant `defaultMonthlySalary` as the base for **every** month (`salary.ts` L124-131). This confirms the three-formula divergence (formula A against B/C).

3. **Dashboard salary due verified.** `getTotalSalaryDue` sums `max(0, round2(outstanding ?? payable))` per operator (`salary.ts` L429-433). Overpaid operators do not offset what is owed to others.

> **How to read this deep dive.** Each feature (F-number) follows the Part 5 deconstruction standard in compressed form:
> *Who / Entry point* = 5.1–5.2 · *Field table* = 5.3 · *Behaviour / Checks* = 5.4 · *Calculations register* = 5.5 · *Connected modules* = 5.6 · *Status tables* = 5.7 · *Historical impact* = 5.8 · *Limitations / Gaps* = 5.10.
> Business outcome (5.9) is stated in the module summary at the top.
> Evidence grades: **A** runtime-verified (none in this audit — no application was run), **B** traced end to end through the code, **C** partly traced, **D** inferred, **E** unverified.
> Paths are relative to `excavator-manager/`. Function names are the authoritative reference; line numbers are as read on 2026-11-24 and may drift.

Shorthand used below:
- `ops` = `src/lib/services/operators.ts`
- `sal` = `src/lib/services/salary.ts`
- `core` = `src/lib/services/salaryCore.ts`
- `wp` = `src/lib/services/workingPeriods.ts`
- `wpa` = `src/lib/services/workingPeriodActions.ts`
- `otx` = `src/lib/services/operatorTransactions.ts`
- `oas` = `src/lib/services/operatorAssignments.ts`
- `vop` = `src/lib/validation/operator.ts`
- `vper` = `src/lib/validation/operatorPeriod.ts`
- `vtx` = `src/lib/validation/operatorTransaction.ts`
- `schema` = `prisma/schema.prisma`
- `UI/` = `src/app/(app)/operators/`

---

## 0. Key conclusions

1. **Salary is time-based only.** No attendance, hour-meter reading, daily log or work session feeds any salary figure. `sal`, `core` and `wp` never query `dailyWorkLog` or `workSession`. Their only inputs are `Operator`, `OperatorWorkingPeriod`, `OperatorLeave` and `OperatorTransaction` (`sal` L238-289, L342-406; `wp` L516-537). There is no overtime and no per-hour pay.
2. **The app runs three different salary formulas side by side:**
   - (a) a calendar-month formula, `computeSalaryForMonth`, that counts the full monthly base for every month (`sal` L238-289);
   - (b) a lifetime daily "anniversary-cycle" accrual, `accrueBaseSalary` (`core` L82-127), used by the Overview tab and the Operators list;
   - (c) a per-working-period accrual, `calculateOperatorPeriods` (`wp` L282-513), used by the Sessions tab and by any operator that is not "legacy shaped".

   The Salary tab (a) and the Overview/Sessions tabs (b, c) can show different "remaining" amounts for the same operator. The Dashboard "Operator Salary Due" uses (a) for legacy operators and (c) for the others (`sal` L564-576).
3. **`businessEffect` matters only for SALARY_PAYMENT and BONUS_INCENTIVE.** ADVANCE_RECOVERABLE, BUSINESS_EXPENSE and OTHER are treated identically. Only the `deductFromSalary` flag decides whether they reduce salary (`core` L21-34). No operator transaction is posted as a business expense in profit.
4. **Dashboard profit:** operator cost = Σ(calendar-month base + bonus) over non-archived operators (`src/lib/services/dashboard.ts` L1019-1023). Deductions, advances, BUSINESS_EXPENSE entries and salary payments are not counted. Archived operators drop out of all past months' cost. Nothing allocates salary per machine.
5. **Archiving is the only "delete".** It does not check any balance and does not end machine assignments. The UI text says "permanently remove ... cannot be undone" (`UI/delete-operator-button.tsx` L58-61), but the operation is a soft archive (`ops` L278-306). There is no unarchive action.

---

## 1. Feature list

### F1. Register operator (owner)
- **Who:** an owner/business user (`requireBusinessApi`, `src/app/api/operators/route.ts` L56-64).
- **Entry point:** `/operators/new` (`UI/new/add-operator-form.tsx` L24-85) calls `POST /api/operators`, which calls `createOperator` (`ops` L150-195).
- **Prerequisites:**
  - The business's `maxOperators` cap, if set, is not reached (`checkOperatorLimit`, `ops` L139-148).
  - Error message: "You've reached your plan's limit of N operators. Contact support to raise it." (409).

| Field | Required | Meaning | Validation (`vop` L21-31) | Default / business impact |
|---|---|---|---|---|
| name | Y | Display name | trim, 1-120 ("Enter operator name" / "Name is too long") | Shown everywhere. Not unique. |
| mobile | Y | Login identity for the portal and join-request matching | trim, 6-20 chars ("Enter a valid mobile number"). Not checked for digits. **Not unique** (`schema` Operator `@@index([mobile])` only) | Used by `matchExistingOperator` (`ops` L475-485) and by operator login candidate lookup (`src/lib/services/auth.ts` L198-202) |
| address | N | Free text | max 500 | none |
| joiningDate | N | Salary start | parseable date string | null means salary starts at `createdAt` (`ops` L177; `sal` L243, L374). Stored with `new Date(iso)`, i.e. UTC midnight (`ops` L166), while periods and leaves use local-midnight `parseDay` (`wp` L74-79). The time-zone mismatch risk is **D**. |
| defaultMonthlySalary | N | Monthly base | coerce number, 0 to 1e9 | 0 if omitted (`ops` L167). The UI input has `step="1"` (`UI/new/add-operator-form.tsx` L71), while the API accepts decimals. |

- **Behaviour:** one transaction creates:
  - the Operator row (`canLogin=false`, `pinHash=null`, schema defaults);
  - **one ACTIVE OperatorWorkingPeriod** with startDate = joiningDate ?? createdAt and monthlySalary = defaultMonthlySalary (`ops` L173-181);
  - an audit entry `operator.create` (L182-189).
- **Not created:** PIN, assignment, transactions.
- **Limitations:**
  - No duplicate-mobile warning.
  - No salary type other than monthly (no daily-wage or hourly option).
  - The UI then redirects to the detail page (`UI/new/add-operator-form.tsx` L20-21).

### F2. Edit operator profile
- **Entry point:** `UI/detail/edit/edit-operator-form.tsx` (L40, L60-61) calls `PATCH /api/operators/[id]` (`src/app/api/operators/[id]/route.ts` L9-18), which calls `updateOperator` (`ops` L199-274).
- **Fields:** same as F1 plus `expectedVersion`. A stale version returns `resourceModified("operator")` (L209).
- **Checks:**
  - Single-period operator with a changed joining date: the new start may not be after the period's endDate ("The joining date cannot be after the end of the working period.", L217-219).
  - It may not overlap any leave ending on or after the new start ("The joining date overlaps a recorded leave. Remove the leave first.", L220-221).
  - Clearing the joining date makes newStart = createdAt (L214).
- **Side effects:**
  - The ACTIVE period's `monthlySalary` is overwritten with the new salary (L241-244). This is **retroactive for the whole active period**, because accrual for that period is recomputed live at the period's single rate (`wp` L389).
  - With exactly one period, its startDate is moved to the joining date (L245-248).
  - Closed periods of a multi-period history are untouched (comment L235-236).
  - Audits `operator.period.update` and `operator.update`.
- **Limitation:** there is no "salary change effective from date X". A raise either rewrites the active period's history or requires starting a new working period (F7) with the new salary.

### F3. Archive ("Delete") operator
- **Entry points:**
  - List trash icon: `UI/delete-operator-button.tsx` L20 sends `DELETE /api/operators/[id]` without a version.
  - Edit page: ArchiveButton (`UI/detail/edit/edit-operator-form.tsx` L48-49, L144) sends it with `?expectedVersion=`.
- **Service:** `archiveOperator` (`ops` L278-306) sets `isArchived=true` and increments `tokenVersion` (kills portal sessions) and `version`. Archiving an already archived operator returns ok (idempotent, L288).
- **Not done:**
  - No outstanding-balance check.
  - No ending of OperatorAssignment rows or clearing of `Excavator.currentOperatorId` (compare `oas` L268-350; nothing is called from archive).
  - No closing of the ACTIVE working period.
  - No cleanup of pending join requests.
- **Effects elsewhere:**
  - Excluded from: the list (`ops` L24), options (L847-848), salary breakdowns and dashboard salary (`sal` L433-435, L491-494), ranking (`ops` L91-93) and performance (`dashboard.ts` L687-689).
  - Portal login is refused (`src/lib/session.ts` L110; `auth.ts` L199).
  - Detail is still readable by id (`getOperatorDetail` has no isArchived filter, `ops` L309-312).
  - `createTransaction` does not check isArchived (`otx` L119-122), so money can still be recorded against an archived operator via the API.
  - `startWorkingPeriod` refuses ("This operator is archived.", `wpa` L220).
  - `createLeave` does not check archived (`wpa` L462-500).
  - `assignOperator` does not check archived (`oas` L279-283).
- **UI copy mismatch:** "permanently remove them, along with their data ... cannot be undone" (`UI/delete-operator-button.tsx` L58-61), yet history is retained. Separately, the generic archive copy says "can be restored later" (`src/components/archive-button.tsx` L48), but no restore exists (grep found no unarchive).

### F4. Portal login enable / PIN set / reset / disable (owner)
- **Entry point:** `UI/detail/operator-pin-card.tsx` L176-180 calls `PATCH /api/operators/[id]/pin` (`src/app/api/operators/[id]/pin/route.ts` L10-23), which calls `setOperatorPin` (`ops` L350-387).
- **Validation:** pin optional; if given with `canLogin=true`, it must match `^\d{4,8}$` ("PIN must be 4-8 digits", `vop` L6-7, L43-53).
- **State machine (`ops` L370-381):**
  - `canLogin=false` → `operator.login.disable`: `canLogin=false`, `pinHash=null`, `tokenVersion+1`.
  - `canLogin=true` with a pin → `operator.pin.set` or `operator.pin.reset`: `canLogin=true`, new hash, `tokenVersion+1`.
  - `canLogin=true`, no pin, already enabled → no-op.
  - `canLogin=true`, no pin, currently disabled → `operator.login.enable`: `canLogin=true` with no PIN. The UI badge shows "Awaiting activation" (`UI/detail/operator-pin-card.tsx` L188-189).
  - Enabling on an archived operator returns NOT_FOUND (L365).
- **Login:** `POST /api/auth/operator-login` (mobile + PIN, `src/app/api/auth/operator-login/route.ts` L10-21) calls `authenticateOperator` (`auth.ts` L189-231).
  - Candidates: same mobile, `canLogin=true`, not archived, oldest first.
  - The first bcrypt match wins.
  - Error: "Wrong mobile number or PIN".
  - Every request re-checks `canLogin`, `isArchived` and `tokenVersion` (`src/lib/session.ts` L98-112).
- **Limitation:** the PIN card does not send `expectedVersion` (`UI/detail/operator-pin-card.tsx` L179).

### F5. Operator self-signup join request (via business code)
- **Who:** an unauthenticated person on `/operator-signup` (`src/app/(operator-auth)/operator-signup/page.tsx` L42-50, form L128-172).
- **API:** `POST /api/auth/operator-signup` (`src/app/api/auth/operator-signup/route.ts` L28-50).
  - Rate limits: 10/hour per IP, 5/hour per mobile, 30/hour per business code.
  - Invalid-code lockout: 5 per 15 minutes per IP, checked before the lookup (L32-37; `ops` L405-466).

| Field | Required | Validation (`vop` L57-68) | Impact |
|---|---|---|---|
| businessCode | Y | 1-20, normalised (`normalizeBusinessCode`) | Unknown code: "Invalid business code — check with your admin." (404) and counts toward the IP lockout (route L40-41) |
| name | Y | 1-120 | Used only if a new Operator is created on approval |
| mobile | Y | 6-20 | Matched against non-archived operators of that business |
| pin | Y | `^\d{4,8}$` | bcrypt-hashed into the request (`ops` L508) |
| confirmPin | Y | must equal pin ("PINs don't match") | none |

- **Behaviour (`requestOperatorJoin`, `ops` L499-565):** inside a per-business advisory lock:
  1. Flip expired PENDING requests to EXPIRED (L519-522).
  2. If any non-archived operator with this mobile already has `canLogin && pinHash`, fail with "This mobile number is already registered — log in instead." (409, L524-525).
  3. If an unexpired PENDING request exists for this mobile: "A request for this number is already waiting for approval - ask your admin." (L527-533).
  4. If 50 or more pending: "Too many join requests are waiting for this business - ask your admin to clear them." (L535-540).
  5. Create a request with:
     - status PENDING;
     - expiresAt = now + 7 days (L400, L552);
     - `verificationHash` = HMAC of a random 6-digit code (L417-431, L549);
     - `operatorId` = the oldest matching non-archived operator without credentials, or null (L551).
- **The request never touches an Operator row.** The response returns the code once (also embedded in `message`, L559-564), with `Cache-Control: no-store` (route L46-49).

### F6. Approve / decline join request (owner)
- **Entry point:** `/operators/approvals`, `UI/approvals/join-request-card.tsx` L34-59.
  - The owner types the 6-digit code; the Approve button is disabled until it is 6 digits (L59, L133).
  - The card shows "Will be linked to your existing operator X" (L77-79) and the expiry date (L75).
- **API:**
  - `POST /api/operators/join-requests/[requestId]/approve` with `{code}` (route L11-23).
  - `POST /api/operators/join-requests/[requestId]/decline`.
  - Legacy routes: `/api/operators/[id]/approve-join` approves only code-less legacy requests, otherwise 409 "...your version of the app cannot enter... approve it from the web app." (`ops` L827-837). Also `/api/operators/[id]/decline-join`.
- **`approveJoinRequest` (`ops` L669-787):**
  1. Lock the request. If not PENDING: APPROVED "already approved" / REJECTED "already declined" / EXPIRED "has expired. Ask the operator to submit a new one." / LOCKED "locked after too many wrong codes" (L633-646).
  2. If past `expiresAt`, set EXPIRED and fail (L676-679).
  3. Malformed code: "Enter the 6-digit verification code" (not counted). Wrong code: `verifyAttempts+1` and "Wrong verification code. N attempts left before this request is locked." On the 5th wrong code, status LOCKED and `decidedAt` set (L681-712; `MAX_JOIN_CODE_ATTEMPTS=5`, L402).
  4. Target resolution:
     - With a linked `operatorId`: the operator must exist and not be archived, else "The operator this request was linked to no longer exists. Decline it and ask them to request again." (L717-724).
     - Otherwise re-match by mobile, because the owner may have added them since (L725-730).
     - A target that already has `canLogin && pinHash`: "This operator already has a working login. Decline this request." (L731-733).
  5. Existing target: set `pinHash` (from the request), `canLogin=true`, `tokenVersion+1`, `version+1`. Name and history are kept (L737-746).
  6. No target: check `maxOperators`, then create a new Operator with name, mobile, pinHash and `canLogin=true`. **There is no joiningDate, salary is 0, and no OperatorWorkingPeriod row is created** (L748-753). Contrast `createOperator` L173-181. Salary then runs on a virtual period from `createdAt` (`wp` L86-103, L109-120) until some write calls `ensureInitialPeriod` (`wp` L123-145).
  7. Request becomes APPROVED with `decidedAt`, `decidedBy`, `operatorId`. Audits `operator.join.approve` plus `operator.login.enable` or `operator.create` (L756-779).
- **Decline:** PENDING → REJECTED with `decidedAt` and `decidedBy` (L790-811). The requester is never told.

### F7. Start new working period ("Start New Session")
- **Entry point:** `UI/detail/sessions-panel.tsx` L134-138 opens `UI/detail/start-session-dialog.tsx`.
  - The preview calls `GET /api/operators/[id]/periods?previewStart&previewEnd` (dialog L56-60; route L20-29), which calls `previewStartPeriod` (`wpa` L182-206).
  - Submit calls `POST /api/operators/[id]/periods` (idempotent, route L38-60), which calls `startWorkingPeriod` (`wpa` L208-356).

| Field | Required | Meaning | Validation (`vper` L28-45) | Default / impact |
|---|---|---|---|---|
| startDate | Y | First day of the new period | `YYYY-MM-DD` | none |
| previousEndDate | N | Last working day of the ACTIVE period being closed | day string | Default: startDate − 1 (`wpa` L78-84). **Ignored if no ACTIVE period**: the last closed period's endDate is used instead. |
| reason | N | RETURNED_FROM_LEAVE / REJOINED_WORK / OTHER | enum | Goes into notes and leave reason (L242-246, L276) |
| reasonText | N | Free text | ≤500 | Notes and leave reason |
| monthlySalary | N | Rate for the new period | 0 to 1e9 | Default: operator.defaultMonthlySalary. If different, **operator.defaultMonthlySalary is also updated** (L241, L303-320) |
| carryForward | Conditional | Carry the previous period's pending into the new one | boolean or "true"/"false" | **Required when the server-computed pending > 0**. Missing: 400 "Previous Working Period has an outstanding balance of X. Choose Carry Forward or Keep Separate." (L229-235) |
| leaveType | N | UNPAID / PAID for the gap | enum | UNPAID (L152, L275) |
| notes | N | ≤1000 | none | none |
| expectedVersion | N | Version of the ACTIVE period | int | Stale: resourceModified (L223) |

- **Checks (`planStart`, `wpa` L66-178):**
  - "The new Working Period must start after the previous one started." (L86-88)
  - "The previous Working Period cannot end before it started." (L89-91)
  - "The new Working Period must start after the previous one ends (periods cannot overlap)." (L92-94)
  - A leave partly covering the gap: "A leave is already recorded between these dates. Remove or adjust it before starting the new Working Period." (L111-116). A leave exactly matching the gap is reused (L104-106).
  - Re-carrying the same source: "This Working Period's balance has already been carried forward." (L237-239). The DB also has a unique `openingSourcePeriodId` (`schema` OperatorWorkingPeriod; migration `20261008100000_working_periods_site_analysis` L75).
  - Archived operator: "This operator is archived." (L220).
- **Pending computation:** a hypothetical recompute with the previous period closed at prevEnd, a stub new period at salary 0, and the gap leave added, with transactions attributed by date only (L121-164).
- **Writes, all in one transaction (L249-344):**
  - close the ACTIVE period (endDate = prevEnd, CLOSED, closedAt, version+1);
  - auto-create an OperatorLeave for the gap if gapDays ≥ 1 (audit `automatic: true`);
  - create the new ACTIVE period with openingBalance = pending (if carried) and openingSourcePeriodId;
  - possibly update the operator's salary;
  - `reattributeTransactions`: re-point every transaction's workingPeriodId to the period its date falls in (`wp` L162-180);
  - audit `operator.period.start` with `previousPending`, `carriedAmount` and `reattributedTransactions`.
- **DB invariant:** at most one ACTIVE period per operator (partial unique index `OperatorWorkingPeriod_one_active_per_operator`, migration L109).
- **UI gaps:**
  - The preview request does not pass `leaveType` (route L26 passes only start/end; the dialog does not include it in `previewKey`, L56-59). The preview pending therefore always assumes an UNPAID gap.
  - If the owner picks PAID and the real pending becomes > 0 while the preview showed ≤ 0, the dialog omits `carryForward` (L100) and the server rejects with the 400 above (**D**).
  - The UI calls the gap a "Holiday gap" (L160).

### F8. Close working period (without starting a new one)
- **Entry point:** `UI/detail/close-session-dialog.tsx` L319-327 sends `PATCH .../periods/[periodId] {close:true, endDate, expectedVersion}`. The service is `updateWorkingPeriod` (`wpa` L362-456).
- **Checks:**
  - Only the ACTIVE period: "Only the active Working Period can be closed." (L388).
  - The end cannot be before the start (L390).
  - endDate defaults to today (L389).
  - **No check against future endDate.** A future endDate would accrue up to that date (`wp` L388 uses endDate+1 regardless of today) (**D**).
- **Effect:** status CLOSED, endDate, closedAt. Accrual stops at endDate inclusive (`wp` L388). Transactions dated after the end still attach to this period until a new period starts (UI text L347-349; `derivePeriodForDate` `wp` L153-158).
- **Other PATCH modes (API only, no UI found):**
  - Notes edit.
  - endDate edit on a CLOSED period: must be before the next start, and locked if the period was carried ("This period's balance has been carried forward, so its dates are locked.") (L396-410).
  - startDate edit on a non-first period: must be after the previous end, no leave overlap ("A leave overlaps those dates. Adjust the leave first."), and the first period is blocked ("The first Working Period starts on the joining date. Change it from Edit Operator.") (L411-429).
  - A date change triggers `reattributeTransactions` (L437-443).
  - **The monthlySalary of a period cannot be edited here** (schema `vper` L48-57 has no salary field).

### F9. Record / delete leave
- **Entry point:** `UI/detail/add-leave-dialog.tsx` L30-43 calls `POST /api/operators/[id]/leaves` (route L19-28), which calls `createLeave` (`wpa` L462-500). Delete is the trash icon in the Leaves list (`UI/detail/sessions-panel.tsx` L120-123, L205-212), which calls `DELETE .../leaves/[leaveId]` and then `deleteLeave` (`wpa` L502-525). **Delete has no confirmation dialog.**

| Field | Req | Validation (`vper` L61-69) | Impact |
|---|---|---|---|
| startDate | Y | day string | none |
| endDate | Y | ≥ startDate ("End date cannot be before the start date") | Inclusive |
| type | N | UNPAID / PAID | UNPAID default |
| reason | N | ≤500 | Shown in deduction lines |

- **Checks:** overlap with another leave: "Another leave is already recorded on these dates." (`wpa` L482-484). Leaves may sit inside a working period (L478-481).
- **Effect:**
  - Turns the operator non-legacy, which switches all salary views to period math (`wp` L148-150).
  - UNPAID inside a period: deducted (formula C4).
  - PAID in a gap: accrues at the preceding period's rate (C5).
  - PAID inside a period: no effect (it accrues as normal, `wp` L341-343).
  - UNPAID in a gap: nothing (the gap earns nothing anyway).
- **Contradictory UI comment:** the code comment says leave "can only sit in the gap after a closed session — the server enforces it" (`UI/detail/add-leave-dialog.tsx` L22). The server and the visible help text (L91-93) allow leave inside a session.
- **No archived check and no leave edit (only delete and re-create).**

### F10. Money transactions (add / edit / delete)
- **Entry points:** Money tab (`UI/detail/page.tsx` L202-236):
  - `AddTransactionDialog` → `POST /api/operators/[id]/transactions` (idempotent, route L24-47) → `createTransaction` (`otx` L112-157)
  - `EditTransactionDialog` → `PATCH .../transactions/[transactionId]` with expectedVersion → `updateTransaction` (L161-211)
  - `DeleteTransactionButton` (confirm dialog) → `DELETE` → `deleteTransaction` (L213-240), a hard delete with an audit `before` snapshot.

| Field | Req | Meaning | Validation (`vtx` L48-70) | Default / impact |
|---|---|---|---|---|
| categoryId | N | Pick from the business catalogue | must belong to the business, else "Category not found" (`otx` L91-93) | Label only, no math |
| newCategoryName | N | Custom category, created once (case-insensitive reuse, `otx` L95-105) | ≤80 | Label only |
| amount | Y | Positive amount | >0, ≤999,999,999,999.99, at most 2 dp ("Amount can have at most 2 decimal places") | round2 stored (`otx` L137) |
| date | Y | Transaction date | parseable | Decides the calendar month (formula A) and the period (formula C). `new Date(input.date)` (`otx` L128) |
| notes | N | ≤1000 | none | Shown in breakdown |
| deductFromSalary | N | "Deduct this amount from salary?" checkbox | boolean or "true"/"false" | **Default true** (`otx` L140; UI default `UI/detail/transaction-form-fields.tsx` L17, L95-104). Ignored for SALARY_PAYMENT and BONUS_INCENTIVE. |
| businessEffect | Y | "How should this affect the business account?" | enum of 5 | UI default ADVANCE_RECOVERABLE (`UI/detail/transaction-form-fields.tsx` L19, L107-115) |
| expectedVersion (edit) | N | Optimistic lock | int | resourceModified("transaction") (`otx` L175) |

- **Default categories:** Salary Advance, Personal Advance, Food, Vegetables, Fuel, Medical, Loan, Bonus, Incentive, Extra Work Payment, Other (`vtx` L19-31). They are seeded per business (`otx` L23-27; called from `auth.ts` registration, L23 import).
- **Category is decoupled from effect:** "Bonus" with the default ADVANCE_RECOVERABLE effect and deduct=true deducts (**D**).
- **workingPeriodId** is resolved server-side from the date (`otx` L129, L182; `wp` L183-186; `ensureInitialPeriod` materialises the virtual period).
- **No lock on closed periods:** edit and delete are allowed on any transaction regardless of period status or carry state.
- **UI:**
  - The list shows category, date, notes, amount and a "Deducted / Not deducted" badge (`UI/detail/page.tsx` L209-227). It does not show `businessEffect`, so a SALARY_PAYMENT shows "Deducted" when its flag is true (**D**: the flag defaults true).
  - Quick-add chip: the most frequent amount among the last 100, shown only if it appears more than once (`otx` L44-66).

### F11. Salary views

| UI place | Service | Formula |
|---|---|---|
| Overview "Since Joining" card + "Detail" dialog | `getLifetimeSalarySummary` (`sal` L342-406) | B (legacy) or C (non-legacy) |
| Salary tab, month navigator | `computeSalaryForMonth` (`sal` L238-289) | A |
| Sessions tab, Overview session card | `getOperatorPeriodsOverview` (`wp` L516-537) | C |
| Operators list "Due / Overpaid" | `getLifetimeSalaryBreakdown` (`sal` L432-475) | B or C |
| Dashboard "Operator Salary Due" | `getTotalSalaryDue` (`sal` L564-576) | A for legacy, C outstanding for complex, positives only |
| Period detail (API only) | `getPeriodDetails` (`wp` L564-647) | C lines |

- Overview card UI: `UI/detail/page.tsx` L160-197; Detail dialog: `UI/detail/salary-breakdown-dialog.tsx`.
- Salary tab UI: `UI/detail/page.tsx` L242-310.
- Sessions UI: `UI/detail/sessions-panel.tsx`, `UI/detail/session-summary-card.tsx`.
- Operators list UI: `UI/page.tsx` L120-123.
- Dashboard: `dashboard.ts` L466.

### F12. Operator ↔ machine assignment (operator side)
- **Entry point:** the Machine page. `POST/DELETE /api/excavators/[id]/assign-operator` (route L9-27) calls `assignOperator` or `endOperatorAssignment` (`oas` L268-409).
- **assignOperator:**
  - Ends every ACTIVE assignment on this machine **and** of this operator (L292-305).
  - Clears `currentOperatorId` on vacated machines (L307-313).
  - Creates a new ACTIVE assignment with `startDate=now` (L315-323) and sets `Excavator.currentOperatorId` (L325-328).
- **End:** sets ENDED and endDate=now, and clears the pointer (L364-378).
- **Dates are always "now"** and cannot be backdated.
- `WorkSession.operatorId` is snapshotted from `currentOperatorId` at job start (`src/lib/services/workSessions.ts` L187-189, L221). Error: "Assign an operator to this machine first, from the Machine page."
- **History:** `getAssignmentHistoryForOperator` and `getAssignmentHistoryForExcavator` exist (`oas` L411-425) but **have no callers** (grep). The operator History tab shows only the last 20 COMPLETED work sessions (`ops` L317-322; `UI/detail/page.tsx` L312-332).

### F13. Ranking and performance (informational)
- **Ranking:** hours over the last 45 days per operator, from APPROVED daily logs plus sessions without logs (`ops` L84-122). Shown on the list page (`UI/page.tsx` L143-167). Not linked to salary.

### F14. Operator language and business code (settings)
- **Business-wide default:** `operatorLanguage` en/hi/mr, set in Settings (`src/app/(app)/settings/operator-language-form.tsx` L12-19; `src/lib/services/settings.ts` L138-147).
- **Operator override:** `POST /api/operator/language` (`src/app/api/operator/language/route.ts` L6-13) calls `updateOperatorOwnLanguage` (`ops` L72-74). Effective language = `operator.language ?? business.operatorLanguage` (`src/lib/session.ts` L121).
- **Business code:** shown and regenerated in `src/app/(app)/settings/business-code-card.tsx` L19-89. Regeneration invalidates the old code immediately (`settings.ts` L35-81). **Pending requests are unaffected** (they are already tied to businessId) (**D**).

---

## 2. Status tables

### 2.1 OperatorWorkingPeriod.status (`schema` OperatorWorkingPeriod; `vper`)

| From | Event | To | Code |
|---|---|---|---|
| (none) | createOperator | ACTIVE | `ops` L173-181 |
| (none) | first write path for an operator without rows (join-approved, legacy) | ACTIVE (materialised from virtual) | `wp` L123-145 |
| ACTIVE | Start New Session | CLOSED (endDate = prevEnd) + new ACTIVE | `wpa` L250-301 |
| ACTIVE | Close Session (`close:true`) | CLOSED | `wpa` L387-394 |
| CLOSED | Start New Session (no active) | stays CLOSED + new ACTIVE | `wpa` L76-84 |
| CLOSED | reopen | **not supported** | none |
| any | delete | **not supported** (no route) | none |

- Constraint: at most one ACTIVE per operator (migration L109).
- Carry link: `openingSourcePeriodId` is unique (L75).

### 2.2 OperatorJoinRequest.status

| From | Event | To | Code |
|---|---|---|---|
| (none) | signup | PENDING (expires in 7 days) | `ops` L542-554 |
| PENDING | expiry noticed (signup, list, approve) | EXPIRED | L519-522, L583-586, L676-679 |
| PENDING | correct code (or legacy with no code) | APPROVED (operatorId set) | L756-759 |
| PENDING | 5th wrong code | LOCKED | L689-704 |
| PENDING | wrong code below 5 | PENDING (verifyAttempts+1) | L706-711 |
| PENDING | decline | REJECTED | L796-799 |
| APPROVED / REJECTED / EXPIRED / LOCKED | any action | terminal, with error messages | L633-646 |

Note: a LOCKED or EXPIRED request no longer blocks a fresh signup, because the duplicate check only looks at unexpired PENDING requests (L527-530).

### 2.3 OperatorAssignment.status ("ACTIVE" default, `schema` OperatorAssignment)

| From | Event | To | Code |
|---|---|---|---|
| (none) | assignOperator | ACTIVE (startDate=now) | `oas` L315-323 |
| ACTIVE | another operator assigned to the same machine | ENDED (endDate=now) | L292-305 |
| ACTIVE | same operator assigned to another machine | ENDED; old machine pointer cleared | L292-313 |
| ACTIVE | end assignment | ENDED | L364-372 |
| ACTIVE | operator archived | **stays ACTIVE** (no hook) | `ops` L278-306 |

---

## 3. Calculations register

**Rounding:** `round2` = ROUND_HALF_UP to 2 dp (`src/lib/money.ts` L8, L33-34). `toMoney` = round2 then toNumber (`core` L12). Accrual partials are kept exact and rounded once (`core` L58-60, L112-114).

### C1. Transaction classification (`core` L21-34)

| Transaction | Bucket |
|---|---|
| businessEffect = SALARY_PAYMENT | paid (deductFromSalary is ignored) |
| businessEffect = BONUS_INCENTIVE | bonus (deductFromSalary is ignored) |
| any other effect, deductFromSalary = true | deductions |
| any other effect, deductFromSalary = false | ignored entirely in salary |

There is no "partial recovery" of an advance: the whole amount deducts in its month or period.

### C2. Daily anniversary-cycle accrual, `accrueBaseSalary(join, asOf, base)` (`core` L82-127)
- **Date handling:** dates are truncated to local days. If asOf ≤ join, the result is 0.
- **Cycles:** each cycle runs from one anniversary of `join` to the next. `addMonthsClamped` clamps to the last day of the month (31 Jan → 28/29 Feb) (L39-44).
- **fullCycles** = number of complete cycles with cycleEnd ≤ asOf.
- **cycleDays** = length of the running cycle (28-31). **elapsedDays** = asOf − cycleStart.
- **Formula:** `total = base × fullCycles + base × elapsedDays ÷ cycleDays`.
- **The asOf day itself is excluded.**
  - Legacy lifetime uses asOf = now (`sal` L386), so **today is not yet earned**.
  - A period uses asOf = endDate + 1 if closed (inclusive end), otherwise now (`wp` L388).
- **`salaryBasisDays` (default 30) is NOT used in accrual.** It only drives the informational `dailySalaryRate = monthlySalary / salaryBasisDays` (`wp` L23-24, L414). No API sets it (absent from `vper`), so it is always 30. The real daily rate is base / cycleDays, so it varies from 28 to 31.

### C3. Legacy lifetime (one ACTIVE period, no leave) (`sal` L374-405; list version L462-474)
- `totalPayable = accrual(joiningDate ?? createdAt → now, defaultMonthlySalary) + Σbonus − Σdeductions`
- `remaining = totalPayable − Σpaid`. Positive means owed to the operator; negative means overpaid.
- **Transaction window:** joiningDate ≤ date < tomorrow. Future-dated and pre-joining transactions are excluded (L377-380).
- **Base used:** `operator.defaultMonthlySalary`, not the period's monthlySalary (they are normally kept equal: `ops` L241-244, `wpa` L303-320).

### C4. Period-based computation (`calculateOperatorPeriods`, `wp` L282-513)

**Transaction ownership (L306-311):**
- Excluded if date < first period start, or date ≥ tomorrow.
- Owner = the stored `workingPeriodId` if valid, else the latest period starting on or before the date. A date before all periods goes to the first period.

**Paid leave salary (L344-356):**
- For each PAID leave, find `prev` = the last period ending before the leave start.
- For the part of the leave outside every period, add `accrual(part.from, part.to, prev.monthlySalary)`. Each part is its own anniversary cycle starting at the leave start.

**Unpaid leave deduction (L362-384):**
- For each UNPAID leave, for each period it intersects (clipped; the active period is clipped at now), subtract `accrual(hit.from, hit.to, period.monthlySalary)`.
- **The deduction rate is base ÷ (length of the cycle that starts on the leave start date)**, not the period's own cycle. Two identical 5-day leaves in different months can cost different amounts (**D**, follows from `core` L108-114).

**Per period (L387-396):**
- `earned = accrual(start → endDate+1 | now, monthlySalary) + paidLeave − unpaidLeave`
- `pending = earned + bonus − deductions + openingBalance − paid`

**Display fields (L401-437):**
- `totalPayable = earned + bonus − deductions + openingBalance`
- `closingBalance = pending`
- `totalPayableDays = asOf − start`

**Carry (L403):** `countedPending = round2(pending) − next.openingBalance` if the period was carried, else `round2(pending)`. Later changes to a carried period still count toward the operator total.

**Operator totals (L440-464):**
- `totalOutstanding = Σ countedPending`
- `currentSessionPending = active.countedPending`
- `previousSessionsPending = totalOutstanding − current`

**Non-legacy lifetime (`sal` L350-371):**
- `totalPayable = outstanding + paid`
- `remaining = totalOutstanding`
- `accrual` and `baseSalary` show **only the current period's** figures. In the Detail dialog, the cycle lines therefore do not add up to Total Payable for multi-period operators (`UI/detail/salary-breakdown-dialog.tsx` L37-66 vs L129-141) (**C**).

### C5. Calendar-month salary (Salary tab; dashboard; profit) (`sal` L238-289; batch version L487-549)
- **`baseFor(month)`:**
  - Legacy operator: the constant `defaultMonthlySalary` for **every** month from the joining month on, including the joining month in full and the current month in full on day 1.
  - Non-legacy: `periodMonthBase` (L174-194). It takes the monthlySalary of the latest period overlapping any day of the month (**full month even for 1 overlapping day**). Else, for a month touched by a PAID leave, the rate of the period preceding the leave. Else 0. **Unpaid leave inside a period is not deducted in this view.**
- **Month totals:**
  - `carriedForward(month) = Σ over prior months since the joining month of (base + bonus − deductions − paid)` (L205-219)
  - `payable = base + bonus − deductions − paid + carriedForward` (L277)
- **Period carry-forward (openingBalance) plays no role here.**
- **Transaction window:** from the joining month start (not the joining day) to the month end (L244-252). This differs from C3, which excludes pre-joining-day transactions.

### C6. Dashboard figures
- **Operator Salary Due** = Σ over non-archived operators of max(0, round2(complex ? outstanding(C4) : payable(C5, current month))) (`sal` L564-576). Overpaid operators do not offset.
- **Operator Salary expense in profit, month mode:** Σ(C5 base + bonus) over non-archived operators (`dashboard.ts` L1019-1023).
- **Range mode:** each month's cost × (days of the month in range ÷ days in month), excluding days after today (`dashboard.ts` L1030-1060).
- **Default (no range) uses the full current month** with no "after today" cut (L929: `salaryCostForMonth` when `!range`), even though the docblock says "never for days after today" (L888) (**C**).
- **Not counted in profit:** deductions (for example damage recovery), ADVANCE / BUSINESS_EXPENSE / OTHER cash outflows, and actual SALARY_PAYMENT cash. Profit is accrual-based on base + bonus only (`dashboard.ts` L975-976).
- **Per-machine operator cost:** none. `siteAnalysis.ts` and `financials.ts` have no salary references (grep).

### C7. Worked examples

**Example 1: legacy operator** (one ACTIVE period, no leave). Today 2026-11-24, joining 2026-07-07, salary 30,000.

Accrual:
- cycles 7 Jul→7 Aug, →7 Sep, →7 Oct, →7 Nov: fullCycles = 4, giving 120,000;
- running cycle 7 Nov→7 Dec: cycleDays = 30, elapsedDays = 24 − 7 = 17 (today excluded);
- partial = 30,000 × 17 ÷ 30 = 17,000;
- accrual = 137,000.

Transactions:

| Date | Effect | deduct | Amount | Bucket |
|---|---|---|---|---|
| 2026-08-15 | ADVANCE_RECOVERABLE | true | 5,000 | deduction |
| 2026-09-02 | BUSINESS_EXPENSE | false | 2,000 | ignored |
| 2026-10-01 | BONUS_INCENTIVE | (any) | 1,000 | bonus |
| monthly | SALARY_PAYMENT | (any) | 4 × 25,000 = 100,000 | paid |

- Overview: Total Payable = 137,000 + 1,000 − 5,000 = **133,000**. Given = 100,000. **Remaining = 33,000.**
- Salary tab for November 2026 (C5), assuming the payments were made 30 Jul, 30 Aug, 30 Sep and 30 Oct:
  - months Jul to Oct each contribute 30,000 base (July in full although joined on the 7th);
  - carriedForward = 4 × 30,000 + 1,000 − 5,000 − 100,000 = 16,000;
  - Nov payable = 30,000 + 16,000 = **46,000**.

The same operator therefore shows 33,000 on the Overview and 46,000 on the Salary tab. The 13,000 difference is exactly 5 full months of base under formula A (Jul to Nov = 150,000) minus the daily accrual under formula B (137,000). Formula A pays July in full although the operator joined on the 7th, and pays all of November on 24 Nov. The gap is structural (**B**).

**Example 2: multi-period** (C4). Sessions use the hypothetical dates below.

Session #1, 2026-01-01 to 2026-03-31, 20,000/month:
- accrual(1 Jan → 1 Apr) = 3 full cycles = 60,000;
- UNPAID leave 10–14 Feb (5 days): accrual(10 Feb → 15 Feb) uses the cycle 10 Feb→10 Mar, 28 days, giving 20,000 × 5 ÷ 28 = 3,571.428571;
- gap 1–10 Apr recorded as PAID at session start: accrual(1 Apr → 11 Apr) uses the cycle 1 Apr→1 May, 30 days, giving 20,000 × 10 ÷ 30 = 6,666.666667;
- earned = 60,000 − 3,571.428571 + 6,666.666667 = 63,095.238096;
- payments 50,000, so pending = 13,095.238096, rounded to **13,095.24**.

Start Session #2 on 2026-04-11 at 22,000 with **Carry Forward**:
- openingBalance = 13,095.24 and openingSourcePeriodId = #1;
- #1 countedPending = 13,095.24 − 13,095.24 = 0.

Session #2 (ACTIVE), as of 2026-11-24:
- 11 Apr→11 Nov = 7 full cycles = 154,000;
- running cycle 11 Nov→11 Dec, 30 days, 13 elapsed: 22,000 × 13 ÷ 30 = 9,533.333;
- earned = 163,533.333;
- payments 150,000, so pending = 163,533.333 + 13,095.24 − 150,000 = **26,628.57**.

Total Outstanding = **26,628.57**.

With **Keep Separate** instead: #1 counted = 13,095.24 and #2 pending = 13,533.33, total = **26,628.57**. This is the same total, just split per session.

Salary tab for April 2026 (C5): base = 22,000 for the full month (Session #2 overlaps April). The PAID April leave days and the Feb unpaid deduction are not reflected. This differs from C4 (**B**).

---

## 4. Scenario answers

| # | Scenario | Supported? | Behaviour and records | Evidence |
|---|---|---|---|---|
| S1 | Operator leaves an assignment | Yes, machine-side only | `endOperatorAssignment`: ACTIVE→ENDED with endDate=now, `Excavator.currentOperatorId=null`, audit (`oas` L352-409). Salary and working period are unaffected; leaving a machine does not close a period. An ACTIVE WorkSession keeps its snapshotted operatorId (`workSessions.ts` L221). | B |
| S2 | Replacement operator | Yes | `assignOperator` with operator B ends A's ACTIVE assignment on that machine, creates B's ACTIVE one and repoints `currentOperatorId` (`oas` L292-328). **Jobs already running keep operator A** (operatorId is set only at start, `workSessions.ts` L221). Hours logged after the swap are credited to A in ranking (`ops` L111-117) unless the job is restarted. `DailyWorkLog.operatorName` is free text only (`schema` DailyWorkLog). No backdating of the swap. | C |
| S3 | Operator on several machines at once | **No** for the pairing | assignOperator ends the operator's other ACTIVE assignments and vacates those machines (`oas` L287-313). Legacy data may have two pointers; the portal prefers the newest assignment (`workSessions.ts` L1045-1062). Not checked: whether a WorkSession on machine X can be started with an archived operator. Overlapping sessions across machines are possible only through stale snapshots (**D**). | B |
| S4 | Attendance missing (is there attendance?) | **No attendance module** | There is no per-day presence record. Salary accrues every calendar day of an ACTIVE period (C2/C4), whether or not daily logs exist. Absence must be entered manually as an UNPAID leave (F9). Daily logs and hours feed only ranking and performance (`ops` L84-122; `dashboard.ts` L684-720). | B |
| S5 | Salary partially paid | Yes | Record a SALARY_PAYMENT for any amount. paid += amount and the remainder stays as pending / remaining / carriedForward (C3-C5). No "salary run" or payslip record; there is no link between a payment and a month or period except by date. | B |
| S6 | Advance outstanding at period close | Handled implicitly | An advance with deductFromSalary=true has already reduced the period's pending. If it exceeds earnings, pending goes negative. At Start New Session, a carry decision is required only if pending > 0 (`wpa` L229-236). **A negative pending (operator owes money) is never carried**: openingBalance is set only when owed > 0 (L236, L297). It stays on the old period and is still counted in totalOutstanding (countedPending = pending), so the total nets correctly, but the new session does not show it as an opening debt (**D**). An advance with deductFromSalary=false is never recovered or tracked anywhere: no "advance outstanding" ledger. | C |
| S7 | Salary record corrected | Partially | There is no stored salary record; salary is computed live. Corrections are made by (a) editing or deleting transactions (F10), (b) editing the operator's salary, which retroactively rewrites the ACTIVE period's rate (`ops` L241-244), (c) adding or deleting leaves, or (d) PATCHing period dates (API only, `wpa` L395-430). A CLOSED period's monthlySalary cannot be edited. All changes are audited, but **past displayed figures change silently**. | B |
| S8 | Transaction edited or deleted after its period closed | **Allowed, no lock** | `updateTransaction` and `deleteTransaction` have no period-status check (`otx` L161-240). The closed period's pending changes. If that period was carried, the carried openingBalance stays fixed, and the delta shows through countedPending = pending − next.openingBalance (`wp` L403), so the operator total stays correct while the closed session shows a non-zero residual. Editing the date re-derives workingPeriodId and can move the transaction to another period (`otx` L182). | B |
| S9 | Operator archived with a balance | Allowed silently | No balance check (`ops` L278-306). The operator disappears from the list, Dashboard Salary Due and profit (`sal` L433-435, L491-494), so **owed salary and recoverable advances vanish from the business totals**. Past months' profit is restated because archived operators' base salary is removed retroactively. Transactions can still be POSTed by id (`otx` L119-122). No unarchive exists. | B |
| S10 | Operator rejoins after leave | Yes | Start New Session (F7): the old ACTIVE period closes on previousEndDate, the gap becomes a leave (UNPAID by default, PAID optional), a new ACTIVE period starts with an optional new salary, and pending > 0 requires Carry Forward or Keep Separate. The joining date is never changed (`wp` L17-19). If the operator was archived, it is blocked ("This operator is archived.", `wpa` L220) and the owner must create a new Operator. A self-signup with the same mobile then links to the new non-archived row only (`ops` L476-479). | B |
| S11 | Self-signup when the owner already created the operator | Yes | The request links to the existing row (`ops` L551). On approval, the PIN is attached to that row and history is kept (L737-746). If the owner already gave it a PIN plus login: 409 "already registered". | B |
| S12 | Approved join with no prior operator | Yes, with caveats | A new Operator is created with salary 0 and no joining date, and **no stored period** (`ops` L751-753). Salary 0 accrues 0 until the owner edits the salary, and that edit then backdates to createdAt (F2). | B |
| S13 | Overtime / hour-based pay | **Not supported** | No field or formula. | B |
| S14 | Bonus tied to hours or jobs | Not supported | A bonus is a manual BONUS_INCENTIVE transaction only. | B |

---

## 5. Gaps (business-functional)

1. **Three inconsistent salary formulas.** The Salary tab counts a full month base, including the joining month and the current month from day 1, and ignores in-period unpaid leave. Overview and Sessions accrue daily. The Dashboard mixes both depending on operator shape (`sal` L174-289 vs `core` L82-127, `wp` L282-513, `sal` L564-576).
2. **`salaryBasisDays` is dead.** It is always 30 and cannot be set; it is shown as "Daily Salary Rate" but never used (`wp` L23-24, L414; `vper` has no field). The actual daily rate is base ÷ 28-31.
3. **`businessEffect` has no accounting effect** beyond SALARY_PAYMENT and BONUS_INCENTIVE. BUSINESS_EXPENSE and OTHER are not posted to expenses or profit. There is no recoverable-advance ledger, recovery schedule or EMI (`core` L21-34; `dashboard.ts` L975).
4. **Profit counts accrued base + bonus only.** Actual payments, non-deducted expenses and deductions are ignored. Archived operators' cost is removed from historical months. There is no machine-wise or site-wise operator cost (`dashboard.ts` L1019-1023).
5. **No attendance** and no link between salary and hours or daily logs. Absence relies on the owner remembering to record UNPAID leave.
6. **Salary change is retroactive** across the whole active period via Edit Operator (`ops` L241-244). A dated raise requires a new session. A closed period's rate cannot be corrected.
7. **Archive does not check balances,** does not end assignments, close the period or decline pending join requests. The UI says "permanently remove", but there is no restore (`ops` L278-306; `UI/delete-operator-button.tsx` L58-61).
8. **No period locking.** Transactions in closed or carried periods remain editable and deletable. Leaves inside closed periods can be added or deleted (`wpa` L462-525; `otx` L161-240).
9. **Negative pending (operator owes) is never carried** to the next session (`wpa` L229-236, L297).
10. **Start-session preview ignores the PAID gap choice,** which can cause a 400 at submit (`src/app/api/operators/[id]/periods/route.ts` L26; `UI/detail/start-session-dialog.tsx` L56-60, L100).
11. **Close Session accepts a future endDate** and would accrue to it (`wpa` L389-393).
12. **The unpaid-leave deduction rate depends on the cycle length starting at the leave date** (28-31), not the period's cycle (`wp` L369).
13. **Legacy lifetime excludes today's day;** closed periods include their end day (`sal` L386 vs `wp` L388).
14. **The Detail dialog for multi-period operators shows only the current period's accrual** next to lifetime totals (`sal` L360-361).
15. **Join-approved operators get no period row and salary 0.** A later salary edit backdates to createdAt (`ops` L751-753; `wp` L86-103).
16. **Mobile is not unique per business.** Several archived and active rows can share it, and login picks the oldest matching PIN (`auth.ts` L198-213).
17. **The operator assignment history service is unused.** The operator History tab shows only the last 20 completed jobs, with no machines-assigned timeline (`oas` L419-425; `ops` L317-322).
18. **No period edit UI** for dates or notes, though the API supports both (`wpa` L362-456). Leave delete has no confirmation (`UI/detail/sessions-panel.tsx` L205-212).
19. **Transaction list does not show businessEffect,** and the "Deducted" badge appears on payments and bonuses whose flag defaults true (`UI/detail/page.tsx` L220-222).
20. **Possible time-zone mismatch** between `new Date(iso)` (UTC midnight) for joiningDate and transaction dates and `parseDay` (local midnight) for periods and leaves (`ops` L166; `otx` L128; `wp` L74-79) (**D/E**: depends on server TZ).
21. **docs/operations.md is referenced as the home of the paid-leave salary rules** (`schema` OperatorLeave comment; `wp` L19), but it contains no salary or leave rules (grep only hit L226) (**C**).
22. **No payslip, salary statement export, or operator-visible salary in the portal** (no salary call in `src/app/api/operator/*`; **C**: portal routes listed and none import salary).

---

## 6. Evidence index

| Topic | File : function : lines |
|---|---|
| Operator schema | `prisma/schema.prisma` : model Operator (fields: defaultMonthlySalary, isArchived, pinHash, canLogin, language) |
| Period / Leave / Transaction / JoinRequest / Assignment schema | `prisma/schema.prisma` : OperatorWorkingPeriod, OperatorLeave, OperatorTransaction (comment states the A formula), OperatorJoinRequest, OperatorAssignment |
| One-ACTIVE index, carry unique | `prisma/migrations/20261008100000_working_periods_site_analysis/migration.sql` L75, L109 |
| Create operator | `ops` createOperator L150-195; checkOperatorLimit L139-148 |
| Edit operator | `ops` updateOperator L199-274 |
| Archive | `ops` archiveOperator L278-306; `src/app/api/operators/[id]/route.ts` DELETE L22-39 |
| PIN | `ops` setOperatorPin L350-387; `vop` L6-7, L43-53; `UI/detail/operator-pin-card.tsx` L176-230 |
| Operator login | `src/lib/services/auth.ts` authenticateOperator L189-231; `src/lib/session.ts` L95-124 |
| Join request | `ops` requestOperatorJoin L499-565; approveJoinRequest L669-787; declineJoinRequest L790-811; legacy L816-844; `src/app/api/auth/operator-signup/route.ts` L28-50 |
| Join UI | `UI/approvals/join-request-card.tsx` L34-136; `src/app/(operator-auth)/operator-signup/page.tsx` L42-104 |
| Accrual engine | `core` accrueBaseSalary L82-127; addMonthsClamped L39-44; applyTransaction / isDeduction L21-34 |
| Month salary | `sal` computeSalaryForMonth L238-289; periodMonthBase L174-194; carriedForwardBalance L205-219 |
| Lifetime salary | `sal` getLifetimeSalarySummary L342-406; getLifetimeSalaryBreakdown L432-475 |
| Dashboard due | `sal` salaryBreakdownExact L487-549; getTotalSalaryDue L564-576 |
| Period math | `wp` calculateOperatorPeriods L282-513; derivePeriodForDate L153-158; reattributeTransactions L162-180; virtualPeriod L86-103; ensureInitialPeriod L123-145; isLegacyShape L148-150; getPeriodDetails L564-647 |
| Start / close period, leaves | `wpa` planStart L66-178; startWorkingPeriod L208-356; updateWorkingPeriod L362-456; createLeave L462-500; deleteLeave L502-525 |
| Period validation | `vper` L5-72 |
| Transactions | `otx` createTransaction L112-157; updateTransaction L161-211; deleteTransaction L213-240; resolveCategoryId L85-106; getMostFrequentAmount L44-66; `vtx` L1-80 |
| Assignments | `oas` assignOperator L268-350; endOperatorAssignment L352-409; history L411-425 (unused) |
| Work-session operator snapshot | `src/lib/services/workSessions.ts` startWork L180-225; getOperatorPortalState L1044-1062 |
| Profit salary cost | `src/lib/services/dashboard.ts` getProfitOverview L888-1016; salaryCostForMonth L1019-1023; salaryCostForRange L1030-1060 |
| Ranking | `ops` getOperatorRankingLast45Days L84-122 |
| Detail page tabs | `UI/detail/page.tsx` L137-333; `UI/detail/salary-breakdown-dialog.tsx` L18-146; `UI/detail/sessions-panel.tsx` L31-219; `UI/detail/session-summary-card.tsx` L16-61; `UI/detail/start-session-dialog.tsx` L39-275; `UI/detail/close-session-dialog.tsx` L22-97; `UI/detail/add-leave-dialog.tsx` L22-107; `UI/detail/transaction-form-fields.tsx` L10-119 |
| Detail API | `src/app/api/operators/detail/route.ts` L15-60; `src/app/api/operators/route.ts` L24-64 |
| Language / code | `src/app/api/operator/language/route.ts` L6-13; `src/lib/services/settings.ts` L35-81, L138-147; `src/app/(app)/settings/business-code-card.tsx` L19-89 |
| Rounding | `src/lib/money.ts` round2 L33-34 |
