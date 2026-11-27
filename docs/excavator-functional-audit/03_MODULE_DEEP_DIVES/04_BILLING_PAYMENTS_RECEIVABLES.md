# Module deep dive — Billing, Payments and Receivables

**Modules covered:**
- Bills (`/bills`): the list, search, the App / Self filter and the register Excel export
- Generate Bill (from work records), Summary Bill (hand-typed grid) and Direct Bill (Self Generated)
- Bill detail: print, PDF / WhatsApp share, per-bill Excel
- Bill edit and delete
- Payments ("Give Money"): add, edit, delete
- Bill numbering, letterhead snapshot, bank accounts, bill template (Standard / Daily Summary)
- Customer outstanding

## Module summary (business outcome)

**Three ways to invoice a customer:**

| Bill type | What goes on it | Link to recorded work |
|---|---|---|
| **Normal bill** | Completed work records the owner selects, priced at one hourly rate | Each work record is permanently marked as billed through its bill line, and cannot be billed twice on another normal bill |
| **Summary bill** | A grid of lines the owner types in (machine, site, dates, hours, rate) | No link to work records |
| **Direct bill** | One machine's Bucket and Breaker hours over a period, pre-filled from recorded hours | Not linked to work records |

**Optional extras on any bill:**
- transport charge (on all three types);
- fuel and extra charges, and a discount (normal and summary bills only);
- GST, split into CGST and SGST;
- diesel the customer supplied, subtracted after tax.

**Payments.** Payments are recorded against one bill at a time, partial or full, never more than the balance. The bill shows Unpaid, Partial or Paid.

**What does not exist:**
- cancellation, credit notes, advances or unallocated receipts;
- a "finalised" lock: any bill, even a paid one, can be edited or deleted.

## Reconciliation notes (main investigator)

| Claim | Verified how | Result |
|---|---|---|
| Work is "billed" only via `BillItem.workSessionId`; Direct and Summary bills create no such link | Read `siteAnalysis.ts` entriesCte (L164 join) and `getCustomerUnbilledWork` (`WHERE NOT v.billed`), and `bills.ts` L375/L434 `billItems: { none: {} }` | **Confirmed.** Hours on a Direct or Summary bill stay "unbilled", so they can be billed again and are counted again in Pending and Revenue |
| Customer pending adds unbilled work value | `customers.ts` L277-280 read directly | **Confirmed** |
| `financials.ts` defines billed / received / pending | Read in full (L1-63) | **Confirmed.** `pending = Σ totalAmount − Σ paidAmount`; site-level received is pro-rated by `paidAmount / totalAmount` |

> **How to read this deep dive.** Each feature (F-number) follows the Part 5 deconstruction standard in compressed form:
> *Who / Entry point* = 5.1–5.2 · *Field table* = 5.3 · *Behaviour / Checks* = 5.4 · *Calculations register* = 5.5 · *Connected modules* = 5.6 · *Status tables* = 5.7 · *Historical impact* = 5.8 · *Limitations / Gaps* = 5.10.
> Business outcome (5.9) is stated in the module summary at the top.
> Evidence grades: **A** runtime-verified (none in this audit — no application was run), **B** traced end to end through the code, **C** partly traced, **D** inferred, **E** unverified.
> Paths are relative to `excavator-manager/`. Function names are the authoritative reference; line numbers are as read on 2026-11-24 and may drift.

---

## 0. Data model (billing part of `prisma/schema.prisma`)

| Model | Key fields | Notes (lines) |
|---|---|---|
| `BillNumberSequence` | businessId, type, prefix, lastNumber | One row per business+type, `@@unique([businessId,type])` (schema 700-710). In practice only type `"NON_GST"` is ever used (bills.ts 210-214). |
| `Bill` | billNumber, billType GST/NON_GST, customerId, bankAccountId?, billDate, subtotal, transportCharges, fuelCharges, extraCharges, bucketCharge, breakerCharge, discount, gstPercentage?, cgst?, sgst?, igst?, buyerGstin?, totalAmount, paidAmount (cached), status UNPAID/PARTIAL/PAID, notes, showCustomerPhone, isDirect, excavatorId?, fromDate?, toDate?, bucketHours/Rate?, breakerHours/Rate?, dieselLiters?, dieselPricePerLiter?, dieselAdvance?, letterhead Json, version | Schema 716-787. `@@unique([businessId,billNumber])` (783). Customer FK is `onDelete: Restrict` (773). Bank account FK is `SetNull` (776). |
| `BillItem` | billId, excavatorId, workSessionId?, siteName (snapshot), attachment?, fromDate, toDate, hours, ratePerHour, amount | Schema 789-813. **`@@unique([workSessionId])`** (809): a session can be on at most one bill line. NULLs are exempt (Summary lines). Cascades on bill delete (801). Session FK is `SetNull` (803). |
| `Payment` | billId, amount, date, method?, notes?, version | Schema 815-829. Cascades on bill delete (825). |
| `Business` | maxBillsPerDay?, billTemplate STANDARD/DAILY_SUMMARY, logos, signature, billTagline, billAccentColor | Schema 44-62. |
| `BankAccount` | label, holder, number, ifsc, bankName, branch, isDefaultForGst, isDefaultForNonGst, isArchived | Schema 118-135. |
| DB CHECKs | `Payment_amount_positive` (amount > 0), `Bill_paid_non_negative`, `Bill_paid_within_total` (paidAmount <= totalAmount) | `prisma/migrations/20261004091000_security_and_integrity/migration.sql` 211-213 (added `NOT VALID`, so they apply to new writes). |

Who can use it: every billing route calls `requireBusinessApi()` (owner session, or support impersonating the owner; actor type `SUPPORT`). See `src/lib/api-auth.ts` 30-50. Operators have no billing access. If the business is frozen, every billing call is blocked (api-auth.ts 34-36). The audit trail tags each entry OWNER or SUPPORT.

---

## 1. Feature list

### F1. Normal bill ("Generate Bill", from work records)

- **Who:** Owner, or support acting as the owner.
- **Entry point:** Bills page → "Generate Bill" (`src/app/(app)/bills/page.tsx` 146) → `/bills/new`.
  - Step 1 picks a customer, plus optional site, machine, from and to (`bills/new/page.tsx` 72-171).
  - Step 2 is `GenerateBillForm` (`bills/new/generate-bill-form.tsx`). The bill is saved with POST `/api/bills` (`src/app/api/bills/route.ts` 8-25) → `createBill` (bills.ts 416-517).
- **Prerequisites:** the customer has work sessions with `status = "COMPLETED"` and no BillItem.
  - The picker query is `listUnbilledWorkSessions` (bills.ts 365-393): `customerId`, `status:"COMPLETED"`, `billItems:{none:{}}`, optional siteId, excavatorId, `startDate >= from`, `endDate <= to 23:59:59.999`. It is capped at 500 rows (`UNBILLED_CAP`, bills.ts 39).
  - Hours come from `WorkSession.totalHours`. That value follows **approved** daily logs when any exist; otherwise it is the typed value or the meter difference (`src/lib/services/workSessions.ts` 275, 375, 649, 946-949). Pending or rejected logs are therefore not billed.
  - **ACTIVE sessions are never offered.**

**Fields** (form: generate-bill-form.tsx 165-190; schema: `generateBillSchema` vb.ts 116-147)

| Field | Required | Meaning | Validation | Default / business impact |
|---|---|---|---|---|
| customerId | Y | Customer billed | min 1 (vb 118) | From step 1. Archived customers are NOT blocked for this bill type (bills.ts 44-47). |
| workSessionIds[] | Y | Work records to bill | 1..1000 (vb 119, "Select at least one work record") | All shown records are pre-ticked (form 75-77). Select All / Deselect All are offered (199-216). |
| ratePerHour | Y | **One rate for every selected line** | money ≥0 ≤1e8 (vb 96,124) | Pre-filled from the current `Site.bucketRate` or `Site.breakerRate`, chosen by attachment (form 80-93, `site-defaults.ts` 22-26). Only applied when all records share one site. Not effective-dated. |
| attachment | N | Bucket / Breaker / none tag printed on **every** line | string | Defaults to the main tool by hours (`site-defaults.ts` 29-38). Changing it moves the rate unless the owner overrode it (form 101-106). |
| siteName | N | Site printed on **every** line | ≤200 | Blank means each session's own site name (bills.ts 504). |
| billDate | Y | Invoice date | parsable date (vb 101-105) | Today (form 299). |
| transportCharges, fuelCharges, extraCharges, discount | N | Flat amounts | money ≥0 | 0 |
| bucketCharge, breakerCharge | N | Legacy flat surcharges | money ≥0 | Not shown on this form; always 0 here. Editable only on old bills that already have them (use-bill-editor.ts 119-125). |
| dieselLiters | N | Litres the customer supplied | hours-type ≥0 | **Sum of `dieselLiters` of the selected sessions, computed in the browser** (form 130). The field is read-only in the UI. The server trusts the value sent (bills.ts 469). |
| dieselPricePerLiter | N | Price per litre | money ≥0 | Blank → 0 (form 116,180) |
| deductDiesel | N | Whether to subtract the diesel advance | boolean, default true (vb 113) | Off: litres and price are stored but dieselAdvance = 0 (bills.ts 259-267). |
| billType | Y | GST / NON_GST | enum | NON_GST (form 118) |
| billNumber | GST: Y; NON_GST: optional manual | Invoice number | GST requires it: "Enter a GST bill number" (vb 140-143) | NON_GST is auto-numbered unless "Enter bill number manually" is ticked (form 405-419). |
| gstPercentage | GST: Y | Tax rate | 0..28 (vb 134). UI offers chips 5/12/18/28 (`bill-math.ts` 14) | 18 (form 119). "Select a GST rate" (vb 144-147). |
| buyerGstin | N | Customer GSTIN | free text, no format check | Not pre-filled from Customer.gstNumber on this form (form 446-447). |
| bankAccountId | N | Bank block to print | must belong to the business and not be archived | Defaults to the account flagged default for this bill type (form 123-124). "None" is allowed. |
| showCustomerPhone | N | Print the customer's mobile | boolean, default true | Stored on the bill (schema 741-744). |
| notes | N | Free text | trimmed | |

**Exact behaviour** (`createBill`, bills.ts 416-517)

1. De-duplicate the ids, then lock the sessions with `SELECT … FOR UPDATE` in id order (104-107, 423-424).
2. Re-read the sessions: same business and customer, COMPLETED, no billItems (428-438).
3. Bank account archived → `CONFLICT` "That bank account was removed. Choose another one or none." (444).
4. Daily limit check (446, 148-160):
   - When `maxBillsPerDay` is set, the business row is locked and bills with `createdAt >= today 00:00` (server local time) are counted.
   - At or over the limit → `BAD_REQUEST` "You've reached your plan's limit of N bills per day. Contact support to raise it."
5. Fewer sessions found than requested:
   - If any missing id has a BillItem → `WORK_SESSION_ALREADY_BILLED` "One or more selected work records have already been billed".
   - Otherwise → `CONFLICT` "One or more selected work records are no longer available to bill" (449-460).
6. Lines: `hours = round2(totalHours)` and `amount = round2(hours × rate)` (462-466). Subtotal = Σ amounts (467).
7. Totals via `normalBillTotals` (275-296). Total < 0 → "The bill total can't be negative — the discount or diesel advance is larger than the charges". Total > 999,999,999,999.99 → "The bill total is too large" (300-306).
8. Bill number via `reserveBillNumber` (523-538), described in F5.
9. Insert the Bill and its BillItems in one statement (`persistNewBill` 339-359):
   - Each BillItem stores excavatorId, **workSessionId**, siteName snapshot, attachment, fromDate = session.startDate, toDate = endDate ?? startDate, hours, rate and amount (500-511).
   - `igst: null` always (494). `letterhead` = `buildLetterhead(business, bankAccount)` (499).
   - A unique-index violation maps to `WORK_SESSION_ALREADY_BILLED` "…were just billed on another bill" or `BILL_NUMBER_TAKEN` (89-99).
   - Audit `bill.create` with source `"work-sessions"` (349-357).
10. The route wraps this in `runIdempotent` with operation `bill.create` (route.ts 17-24). The client sends an Idempotency-Key that stays the same across retries (`use-idempotency-key.ts` 12-29). On success the browser redirects to `/bills/detail?id=` (form 72).

- **Status after creation:** `status` defaults to UNPAID and `paidAmount` to 0 (schema 737-738). **The work session's own status is not changed.** "Billed" is derived from the BillItem existing.
- **Connected modules:** WorkSessions (eligibility and hours), Sites (rate default), Settings (letterhead, bank), Site Analysis (a session counts as billed once a BillItem exists, `siteAnalysis.ts` 141, 164), Dashboard and Customers (receivables).
- **Limitations:**
  - One rate, attachment and site name apply to all lines. Mixed Bucket and Breaker work at different rates needs separate bills or an edit afterwards.
  - The rate default is the site's current rate, not the rate in force on the work date.
  - The picker ignores the archived flag on customers, but customer options exclude archived customers (`customers.ts` 171-178). So step 1 cannot pick an archived customer unless the URL is typed (D).
  - No partial-session billing.

### F2. Direct bill ("Self Generated" bill)

- **Entry point:** Bills page → Direct (`bills/page.tsx` 136) → `/bills/new/direct`.
  - Customer picker with "+ Add new customer" inline (`new/direct/page.tsx` 77-116; `new-customer-fields.tsx` 24-30 POSTs to `/api/customers`).
  - Form: `generate-direct-bill-form.tsx`. Saved with POST `/api/bills/direct` (`api/bills/direct/route.ts`) → `createDirectBill` (bills.ts 664-736).
- **Purpose** (schema comment 745-755): a standalone invoice for one machine's bucket and breaker hours, typed in by hand. **It has no BillItems and no workSessionId link.**
- **Hours source:** a helper GET `/api/bills/direct/hours` calls `getRecordedHoursForBilling` (`siteAnalysis.ts` 516-545).
  - It sums approved DailyWorkLog hours, plus session-level hours for sessions with no logs, for that customer, machine and date range.
  - Hours are grouped as BUCKET, BREAKER or OTHER by matching the attachment text, and only entries **not on a BillItem** are counted.
  - **ACTIVE sessions are included** (entriesCte 101-127 excludes only ACTIVE sessions with 0 hours and 0 diesel).
  - The hours pre-fill the form until the owner types over them (form 76-93). Hint text: "…not billed yet", "… already on a bill, so it is left out" (form 592-609).
- **Rate source:** the current `bucketRate` / `breakerRate` of the customer's first site (ACTIVE sites first) (form 94-96, `site-defaults.ts` 14-19). Editable.

**Fields** (`generateDirectBillSchema` vdb.ts 321-362; submit form 130-155)

| Field | Req | Meaning | Validation | Default / impact |
|---|---|---|---|---|
| customerId | Y | | must belong to the business: "Customer not found"; archived → "This customer was removed. Choose another customer." (bills.ts 681-683) | |
| excavatorId | Y | Single machine | "Select a machine" / "Machine not found" | blank |
| billDate | Y | | date | today |
| fromDate, toDate | Y | Hire period | to ≥ from: "End date must be on or after the start date" | today / today |
| bucketHours, bucketRate, breakerHours, breakerRate | N | Two line items | ≥0 | recorded hours / site rates |
| transportCharges | N | Flat amount | ≥0 | 0 |
| dieselLiters, dieselPricePerLiter | N | Customer-supplied diesel | ≥0 | 0. **No deduct toggle in this form.** `deductDiesel` is not sent, so the schema default `true` applies (vdb 335), and the preview always deducts (form 116). |
| billType / billNumber / gstPercentage / buyerGstin / bankAccountId / showCustomerPhone / notes | as F1 | | same refinements (vdb 344-351) | |
| (absent) | — | fuel, extra, bucketCharge, breakerCharge, discount | not accepted | always 0 on a direct bill |

- **Checks:**
  - Bucket + breaker + transport amount must be > 0: "Enter bucket hours, breaker hours, or transport charges". This is checked by the schema (vdb 352-358) and again on the server against taxable (bills.ts 690-692).
  - Daily limit, total bounds and bill number work as in F1.
- **Record created:** a Bill with `isDirect = true`, the excavator, the period and the bucket/breaker/diesel fields. No items. Audit source `"direct"` (bills.ts 699-734). Idempotent via `bill.direct.create`.
- **Limitations:**
  - One machine per bill.
  - The hours are **not linked**. Creating a direct bill does not mark the underlying work as billed (see Gaps G1).
  - No discount.

### F3. Summary bill (hand-typed grid)

- **Entry point:** Bills page → Summary (`bills/page.tsx` 125) → `/bills/new/summary` → `BillEditorForm` in create mode (`new/summary/page.tsx`). Options come from GET `/api/bills/new/summary`.
- **Save:** POST `/api/bills/summary` → `createSummaryBill` (bills.ts 544-614).
- **Lines are typed in**, with help from:
  - **Quick Fill:** one row per day per machine, or one row per machine for the period, capped at 62 days (`bill-math.ts` 276-299, 18).
  - Paste a column from Excel (247-272), duplicate a row, Enter to add a row, and "apply rate to all" (`use-bill-editor.ts` 163-217).
  - A row with no rate takes the matching site's saved rate for its tool (61-72). The row's site defaults to the customer's linked site, otherwise the machine's current site (65-66).
- **No workSessionId** is set on the lines (bills.ts 540-543). No session or log is consulted or marked.

**Fields** (`generateSummaryBillSchema` vb 182-204; `billItemInputSchema` 163-176; payload in `buildPayload` bill-math 142-198)

| Field | Req | Validation |
|---|---|---|
| items[].excavatorId | Y | "Select a machine on every row"; must belong to the business, else "One of the selected machines was not found" (bills.ts 570-573) |
| items[].siteName | Y | "Enter a site on every row" (free text, not linked to a Site) |
| items[].attachment | N | free text |
| items[].fromDate / toDate | Y | "Enter a date on every row"; "A row's end date is before its start date" |
| items[].hours | Y (>0 in UI) | ≥0 on the server; the UI blocks 0 ("Every row needs a machine, a site and hours", bill-math 130-132) |
| items[].ratePerHour | Y | ≥0 |
| items | Y | 1..1000 ("Add at least one row") |
| transport, fuel, extra, discount (+ legacy bucket and breaker) | N | ≥0 |
| diesel fields + deductDiesel | N | litres can be typed here; there is a deduct checkbox (`diesel-fields.tsx` 36-50) |
| customer / billType / number / GST / bank / phone / notes | as F1 | customer must exist and not be archived (bills.ts 563-565) |

- **Behaviour:** daily limit; per-line `amount = round2(round2(h) × round2(r))` (318-333); `normalBillTotals`; bill number; insert. Audit source `"summary"`. Idempotent via `bill.summary.create`.
- **List classification:** shows under "Generated by App" (`isDirect = false`) together with normal bills (`countBillsByType` bills.ts 1065-1073). There is no separate "Summary" filter.

### F4. Bill totals (all types). See section 3.

### F5. Bill numbering

- **NON_GST, auto:**
  - The `BillNumberSequence` row (businessId, "NON_GST") is upserted, created at 1 or incremented, with prefix `"NG-"` (bills.ts 34, 209-214).
  - Format: `prefix + 4-digit zero-padded number`, e.g. `NG-0001`; numbers past 9999 grow wider (187-189).
  - A candidate already used (for example by a manual number) is skipped. After 50 consecutive taken numbers → "Could not find a free bill number — enter one manually" (536).
  - The sequence row stays locked until commit, so concurrent creates cannot take the same number. A rollback (failed create) also rolls back the increment (atomic(), 72-87).
- **NON_GST, manual:** the typed string is used as-is and the sequence does not advance (206-207). An already-used number → `BILL_NUMBER_TAKEN` "That bill number is already used — pick a different one" (529-533).
- **GST:** always manual and required (vb 140). There is **no GST sequence or prefix** (206). Uniqueness covers all bills of the business: GST and NON_GST share one namespace (`@@unique([businessId,billNumber])`).
- **Preview:** "Next bill number" uses `previewNextNonGstBillNumber` (397-403) and is not reserved, so a different number can be issued if someone else bills first.
- **Gaps:** deleting a bill never re-uses its number, so the sequence keeps a gap (deleteBill 931-959 does not touch the sequence). An edit can change the number to any unused string (778-780, vb 218).

### F6. Letterhead snapshot, template, bank account, phone flag

- **`buildLetterhead`** (bills.ts 162-185) copies onto the bill at creation: businessName, ownerName, address, phone, GSTIN, tagline, both logos, signature, accentColor and the bank account (label, holder, number, ifsc, bankName, branch).
  - **Not snapshotted:** customer name, address and mobile. They are read live from `Customer` when the bill is shown (`toBillPreviewData` 1100-1102). Renaming a customer, or changing their address or phone, changes every past bill (G7).
  - The bill **template** (STANDARD vs DAILY_SUMMARY) is not snapshotted either. It is one business-wide setting, read on every GET `/api/bills/[id]` (`api/bills/[id]/route.ts` 20-27) and changed from the Bills tab picker (`bill-template-picker.tsx` 19-23 → PATCH `/api/settings/bill-template` → `updateBillTemplate` settings.ts 163). Switching it re-renders every bill.
- **DAILY_SUMMARY rows** (`billSummary.ts` 23-131) are rebuilt from **live** approved DailyWorkLogs of the linked sessions:
  - They are used only when the logs' summed hours equal the billed line hours (80). Otherwise the bill shows one row per line.
  - Each day's amount = round2(hours × line rate); the last day absorbs rounding so the days add up to the line amount (86-90).
  - Diesel-only days appear as 0-amount rows (108-110). A direct bill gives one Bucket row and one Breaker row (24-48). Summary lines give one row each.
- **Bank accounts:** chosen per bill.
  - The default follows the bill type through the `isDefaultForGst` / `isDefaultForNonGst` flags (settings.ts 290-330).
  - Archived accounts are hidden from lists (`listBankAccounts` 279-281) and refused on create (bills.ts 444, 565, 684). On edit, a bill may keep an archived account but not switch to one (776).
  - Archiving does not change past bills, because the bank block lives in the letterhead JSON. `bankAccountId` stays (FK SetNull applies only on hard delete).
- **showCustomerPhone:** a per-bill checkbox, frozen on the bill (schema 741-744). Used by the preview (`bill-preview.tsx` 140) and Excel (`billExcel.ts` 196-197).

### F7. View, print, PDF, WhatsApp share, per-bill Excel

- **Detail page** `bills/detail/page.tsx`:
  - Total, Paid and Pending boxes, where Pending = total − paidAmount in paise (58-59, 103-117).
  - Template picker, bill preview, payments section, and "Bill generated <createdAt>" (132-134).
- **Print:** `window.print()`, or the native print plugin in the app (`print-button.tsx` 11-14).
- **Share on WhatsApp** (`share-bill-button.tsx`):
  - Builds a PDF of the on-screen bill (`bill-pdf.ts`).
  - Message: business name, "Bill <no>", "Total: ₹…", then "Balance due: ₹…" or "Paid in full — thank you." (16-26).
  - Routes: Android share sheet, `navigator.share` with the file, or on desktop a PDF download plus a `wa.me/<91+10 digits>` link (56-90; `waNumber` bill-pdf.ts 89-94).
- **Per-bill Excel:** GET `/api/bills/[id]/export` → `buildBillWorkbook(toBillPreviewData(bill))` (`[id]/export/route.ts` 18-22).
  - Contents: header, customer, phone (if allowed), GSTIN, items or bucket/breaker lines, Sub Total, each non-zero charge, Discount, CGST/SGST (rate shown halved), Diesel Advance, Grand Total, amount in words, bank block, signature (`billExcel.ts` 93-396).
  - **Always the STANDARD layout**: no template or summaryRows are passed (D). No payments or paid status in the file.
  - Rate-limited (`exportRules`). Audit `bill.export`.
- **Amount in words:** `amountInWords` speaks rupees and paise ("… Rupees and NN Paise Only") (`numberToWords.ts` 41-49).

### F8. Bills list, search, filters, register export

- **List:** GET `/api/bills` → `listBills` (bills.ts 1003-1031).
  - Order: billDate desc, then id desc. Cursor pagination, 50 per page in the UI (`bills/page.tsx` 34). Filter pills: All / Generated by App (isDirect = false) / Self Generated (isDirect = true) (page.tsx 20-24). An optional `customerId` comes from the URL.
  - **Search** `q` (≤100 characters, ≤6 words, every word must match) covers bill number, customer name or company, direct-bill machine name or number, item site name, item machine, or an exact total amount (980-1001).
  - Each row shows a status badge and "₹X pending" when pending > 0.01 (`bills-list.tsx` 80-117).
  - **Not available in the UI:** date filters (from/to exist in the service, but the list route does not pass them; route.ts 41), a status filter, and a GST/Non-GST filter.
- **Register export:** GET `/api/bills/export` (`api/bills/export/route.ts`).
  - Query validated by `billsExportQuerySchema` (vb 280-287): customerId, filter app/self, from, to (YYYY-MM-DD), q. **The UI sends only customerId, filter and q** (page.tsx 104-111).
  - Columns: Bill No., Date, Customer, Type, Site(s), Total, Paid, Pending, Status, plus footer totals with exact sums (`billExcel.ts` 398, 404-516).
  - Capped at 20,000 rows. When truncated, an "INCOMPLETE: only the first N bills…" banner is added and the `X-Export-Truncated` header is set (bills.ts 41, 1038-1055; billExcel 443-448).
  - Audit `bills.export` with the filters and row count.

### F9. Bill edit

- **Entry point:** Detail → Edit → `/bills/edit?id=` (`bills/edit/page.tsx`) → `BillEditorForm` in edit mode → PATCH `/api/bills/[id]` → `updateBill` (bills.ts 752-926).
- **Editable:** everything. Customer, number (required: "Enter a bill number", vb 218), date, type, GST rate, buyer GSTIN, bank, notes, phone flag, all charges, diesel and deduct flag.
  - Normal and summary bills: all rows (add, remove, duplicate, change machine, site, dates, hours, rate, attachment).
  - Direct bills: machine, period, bucket and breaker hours and rates, transport. Only `directBillAmounts` is used, so fuel, extra and discount stay unchanged (808-836).
- **Allowed at any time, including after full payment.** There is no lock or finalisation state.
- **Checks:**
  - Bill lock plus `expectedVersion` → `RESOURCE_MODIFIED` (760-762). The UI shows a conflict and reload (use-bill-editor 242-251, edit/page 50-53).
  - Customer exists. It may keep an archived customer but not switch to one (772-775). Same rule for the bank account (776).
  - Bill number unique except for itself (778-780).
  - Direct: "Select a machine and the period", "Enter a valid date", "Machine not found" (809-816).
  - Non-direct: "A bill needs at least one row" (839), machine ownership (840-847).
  - Total bounds (877-878). **New total < sum of payments → `BILL_TOTAL_BELOW_PAID`** "The new total (₹X) is lower than the ₹Y already paid. Change or remove a payment first." (879-884).
- **Lines:** all BillItems are deleted and recreated (888-891).
  - A row that carries its original `id` keeps that line's `workSessionId`. A repeated id keeps it only on the first occurrence (849-860).
  - Duplicated rows get `id: undefined`, so no link (use-bill-editor 188).
  - **A removed linked row frees its session for re-billing** (comment 746-747; the session again matches `billItems: none`).
  - **Hours and rate of linked rows can be changed freely.** Nothing re-reads the session hours.
- **Recalculation:** totals recomputed from scratch. `paidAmount` = the actual Σ payments (heals drift). `status` = paymentStatus(paid, newTotal). Version + 1 (892-901).
- **Letterhead is re-stamped from the current Settings on every edit** (782-788). The audit `bill.update` records before and after (without the letterhead) plus `letterheadRefreshed` (910-922).
- **No edit reason in the UI:** `reason` is accepted by the API (vb 237) but the UI payload never sends it (bill-math 142-198; grep finds no "reason" in the bill UI).
- **The edit form opens with the deduct-diesel tick** set to `dieselLiters == 0 || dieselAdvance > 0` (edit/page.tsx 96-98).

### F10. Bill delete (the only cancellation)

- **Entry point:** Detail → trash icon → confirm "Delete this bill and its payments? This cannot be undone." → DELETE `/api/bills/[id]?expectedVersion=` (`detail/page.tsx` 40-54) → `deleteBill` (bills.ts 931-959).
- **Effect:**
  - Takes the lock and runs the version check.
  - Writes an audit `bill.delete` whose `before` holds the full bill, items **and payments**.
  - Hard-deletes the Bill. BillItems and **Payments cascade** (schema 801, 825).
  - The covered sessions become billable again.
- **Allowed with payments recorded:** there is no guard. There is **no void, cancel or credit-note status**, and the bill number is not re-used.

### F11. Payments

- **Entry point:** Detail → "Give Money", shown only when pending > 0.01 (`payment-section.tsx` 124-129). POST `/api/bills/[id]/payments` (idempotent `payment.create`) → `addPayment` (bills.ts 1160-1210).

| Field | Req | Validation | Default |
|---|---|---|---|
| amount | Y | 0.01 ≤ amount ≤ 999,999,999,999 (vb 248-251); server `round2` > 0: "Enter an amount greater than 0"; ≤ remaining | the full pending amount (section 140); HTML `max=pending` |
| date | Y | parsable date | today |
| method | N | **free text**, placeholder "Cash / UPI / Bank" (section 65-68) | — |
| notes | N | free text | — |

- **Add:**
  - Lock the bill, then `paidBefore = Σ payments` (1173).
  - `amount > total − paidBefore` → `PAYMENT_EXCEEDS_BALANCE` "Amount exceeds the pending balance of ₹X" (1150-1153, 1175).
  - Create the Payment, set Bill.paidAmount = paidBefore + amount and status = paymentStatus, version + 1 (1177-1196). Audit `payment.create` with paidBefore, paidAfter and status.
- **Edit** (pencil): PATCH `…/payments/[paymentId]` → `updatePayment` (1214-1278).
  - Version check on the payment.
  - `amount ≤ total − Σ others`. Updates amount, date, method and notes. Recomputes paid and status. Audit `payment.update`.
- **Delete** (trash, confirm "Delete this payment?"): DELETE → `deletePayment` (1280-1319). Hard delete, recompute, audit `payment.delete`.
- **Multiple payments per bill:** yes. **Partial payments:** yes.
- **Not supported:**
  - Overpayment.
  - Advance or unallocated payments: every Payment needs a billId (schema 819).
  - One receipt split over several bills.
  - Customer-level payments.
  - Receipt documents or numbering.
  - Refunds or reversals other than deleting or editing the payment.
  - TDS or write-off fields.
- **Moving a payment:** there is no "move to another bill". To fix a payment on the wrong bill, delete it and re-add it on the right bill.

### F12. Receivables / outstanding

- **Per bill:** `totalAmount − paidAmount` (detail 58-59; list 83; register 462).
- **Customer list** (`customers.ts` 49-96):
  - `totalRevenue = Σ bill.totalAmount + unbilledValue(customer)`
  - `pending = that − Σ bill.paidAmount`
  - The summary cards use the same rule over all filtered customers (98-133).
- **Customer detail** (`customers.ts` 268-281): `pending = (Σ total − Σ paid) + Σ unbilledWork.amount` (`sumBills` financials.ts 31-36).
- **unbilledValue** (`siteAnalysis.ts` 97-187): approved logs, or log-less sessions, not on any BillItem, valued at `hours × rate in force on the work date` (SiteRateHistory, effective-dated, 166-174). Only for Bucket and Breaker; OTHER work counts as 0. **This includes ACTIVE sessions' approved logs and does not exclude hours already invoiced on a Direct or Summary bill.**
- **Dashboard** (`dashboard.ts` 479-501):
  - `revenueThisMonth = Σ totalAmount` where billDate is in the month.
  - `pendingPayments = Σ(total − paid)` over UNPAID and PARTIAL bills.
  - `totalRevenueAllTime = Σ all bills' totalAmount + siteTotals.unbilledRevenue`.
  - `pendingAmount = totalRevenueAllTime − Σ all payments`.
  - `amountReceivedInRange = Σ payments by Payment.date`.
- **Revenue is recognised on the bill (billDate), not on collection.** totalAmount is net of the diesel advance and includes GST.

---

## 2. Status tables

### Bill payment status (`paymentStatus`, money.ts 69-73)

| Condition (paid = Σ payments) | Status |
|---|---|
| paid ≤ 0 | UNPAID |
| 0 < paid < total | PARTIAL |
| paid ≥ total | PAID (only = total is possible: CHECK and service guards) |

| Transition trigger | Where | Notes |
|---|---|---|
| create bill | schema default | UNPAID, paid 0 |
| add payment | bills.ts 1188-1196 | UNPAID→PARTIAL/PAID, PARTIAL→PAID |
| edit payment | 1254-1262 | any direction |
| delete payment | 1296-1304 | PAID/PARTIAL→PARTIAL/UNPAID |
| edit bill (total changed) | 892-901 | e.g. PAID→PARTIAL when the total rises. The total cannot drop below paid. A bill of total 0 with paid 0 is UNPAID. |
| delete bill | 956 | row gone, no status kept |

- There is no DRAFT, ISSUED, CANCELLED, VOID, OVERDUE or due-date concept. No `dueDate` field exists (schema 716-787).
- There is also no WorkSession "BILLED" status. Billed means a BillItem exists for the session (bills.ts 375, 434; siteAnalysis 141).

### Payment record
Payments have no status field. Their lifecycle is create → (edit)* → delete (hard).

---

## 3. Calculations register

| # | Name | Formula | Source |
|---|---|---|---|
| C1 | round2 | ROUND_HALF_UP to 2 dp on a Decimal | money.ts 33-35 |
| C2 | line amount | `round2(round2(hours) × round2(rate))` | money.ts 42-44; bills.ts 462-466, 318-333 |
| C3 | subtotal (normal and summary) | Σ line amounts | bills.ts 467, 576 |
| C4 | taxable (normal and summary) | `subtotal + transport + fuel + extra + bucketCharge + breakerCharge − discount` (each charge round2'd first) | bills.ts 242-251, 284-291 |
| C5 | GST | rate = round2(gstPercentage) only if billType = GST. `tax = round2(taxable × rate / 100)`, `CGST = round2(tax/2)`, `SGST = tax − CGST`. A rate of 0 or null gives no tax and null cgst/sgst. **IGST is always null** (no inter-state option). | money.ts 59-65; bills.ts 269-271, 494 |
| C6 | diesel advance | `deductDiesel === false ? 0 : round2(round2(L) × round2(price))` | bills.ts 259-267 |
| C7 | total (normal and summary) | `round2(taxable + tax − dieselAdvance)`. Must be 0 ≤ total ≤ 999,999,999,999.99. **Diesel is taken off after tax**, so GST is charged on the full taxable amount. | bills.ts 294, 300-306 |
| C8 | direct subtotal | `round2(line(bucketH, bucketR) + line(breakerH, breakerR))` | bills.ts 636 |
| C9 | direct taxable | `round2(subtotal + transport)` (no fuel, extra or discount) | 637 |
| C10 | direct total | `round2(taxable + tax − dieselAdvance)`. Requires taxable > 0. | 638-640, 690 |
| C11 | pending per bill | `totalAmount − paidAmount` | detail 58-59 |
| C12 | payment cap | add: `amount ≤ total − Σ payments`; edit: `amount ≤ total − Σ other payments` | 1174-1175, 1239-1241 |
| C13 | customer pending | `Σ total − Σ paid + Σ unbilled(hours × dated site rate)` | customers.ts 83-91, 277-280 |
| C14 | dashboard pendingAmount | `Σ all bill totals + unbilledRevenue − Σ all payments` | dashboard.ts 497-501 |
| C15 | dashboard pendingPayments | `Σ(total − paid)` over UNPAID and PARTIAL | dashboard.ts 448-451, 483 |
| C16 | billed-session revenue share (Site Analysis) | `biAmount × share`, where share = uv/Σuv, else hours/sessHours, else 1/count. paidFrac = paid/total. | siteAnalysis.ts 176-187; financials.ts 57 |
| C17 | Daily Summary day split | day amount = line(hoursWorked, rate); the last day = remaining line amount | billSummary.ts 86-90 |
| C18 | client preview | the same formulas in integer paise (half away from zero) | money-preview.ts 14-41; bill-math.ts 47-103 |

### Worked examples (computed by hand from the formulas above)

**Normal bill (C2-C7):**
- Inputs: sessions A = 8.5 h and B = 10.25 h, rate ₹1,200, transport 2,000, fuel 0, extra 500, discount 1,000, GST 18%, diesel 50 L × ₹92.50, deduct on.
- Lines: 8.5 × 1200 = 10,200.00 and 10.25 × 1200 = 12,300.00. Subtotal = 22,500.00.
- Taxable = 22,500 + 2,000 + 0 + 500 + 0 + 0 − 1,000 = **24,000.00**.
- Tax = round2(24,000 × 18/100) = 4,320.00. CGST = 2,160.00, SGST = 2,160.00.
- Diesel = 50 × 92.50 = 4,625.00.
- **Total = 24,000 + 4,320 − 4,625 = 23,695.00.**
- Payments: ₹10,000 makes it PARTIAL (pending 13,695.00). Then ₹13,695 makes it PAID. Any further ₹1 → "Amount exceeds the pending balance of ₹0.00".

**Direct bill (C8-C10):**
- Inputs: bucket 20 h × ₹1,100 = 22,000.00, breaker 5.5 h × ₹1,800 = 9,900.00, transport 1,500, NON_GST, diesel 100 L × ₹90 (always deducted from this form).
- Subtotal = 31,900.00. Taxable = 33,400.00. Tax = 0.
- **Total = 33,400 − 9,000 = 24,400.00.**

**Summary bill:**
- Rows: (M1, 8 h × 1,000) = 8,000.00; (M1, 7.75 h × 1,000) = 7,750.00; (M2, 9 h × 1,500) = 13,500.00. Subtotal = 29,250.00.
- Extra 250, so taxable = 29,500.00. GST 5% → tax = 1,475.00, CGST = round2(737.5) = 737.50, SGST = 737.50.
- **Total = 30,975.00.**
- Odd-paise case: taxable 100.10 at 5% → tax = round2(5.005) = 5.01, CGST = round2(2.505) = 2.51, SGST = 2.50.

---

## 4. Answers to the 12 questions

1. **What is used to generate a bill?**
   - Normal: customer, completed unbilled WorkSessions (their totalHours, start and end dates, site name and diesel litres), one rate, optional attachment and site override, charges, discount, diesel price, GST settings, bank account, business settings for the letterhead (bills.ts 416-517).
   - Summary: typed rows (machine, site text, dates, hours, rate).
   - Direct: one machine, a period, bucket and breaker hours and rates (pre-filled from recorded unbilled hours), transport and diesel.
   - The rate default is always the current Site rate (B).
2. **Are working-hour entries automatically available?** Yes for normal bills. Every COMPLETED session with no BillItem for the customer is listed and pre-ticked (bills.ts 365-393; form 75-77). Direct bills auto-fill hour totals but do not link them. Summary bills do not use them (B).
3. **Can the user choose specific records?** Yes. There are checkboxes per session plus site, machine and date pre-filters. Individual daily logs inside a session cannot be chosen; a session is all or nothing (form 224-248) (B).
4. **Multi-machine?**
   - Normal: yes, sessions from any machines, but at **one rate**.
   - Summary: yes, any machine per row, each with its own rate.
   - Direct: one machine only (B).
5. **Multiple bills per site?** Yes. There is no site-level constraint, and a bill is not tied to a site. Different sessions at the same site can go on different bills. The site name is just text on each line (D/B).
6. **Partial billing of completed work, or part of an ACTIVE session?**
   - The normal flow never offers ACTIVE sessions or part of a session.
   - It is possible indirectly: a Direct bill's hour helper includes approved logs of ACTIVE sessions (siteAnalysis entriesCte 115, 125), and a Summary bill can contain any hours. Neither marks the work as billed (C).
7. **Double-billing prevention:**
   - Between normal bills: strong. There is a row lock, an in-transaction re-check and a DB unique index on BillItem.workSessionId, giving `WORK_SESSION_ALREADY_BILLED` (bills.ts 101-107, 423-460, 89-99; schema 809). Retries are covered by an Idempotency-Key (B).
   - Direct and Summary bills versus sessions: **no protection**. See G1 and G2.
8. **Does changing a work record affect an existing bill?** No.
   - `updateWorkSession` may change hours, customer, site and dates of a billed session. The BillItem keeps its snapshot (workSessions.ts 902-908, 980-991). The only trace is `billed: true` in the audit.
   - Approving or adding logs on a billed session raises session hours without changing the bill, and those extra hours can never be billed through the normal flow, because the session is already "billed".
   - Deleting a billed session is refused: "This work is already on a bill — edit or delete that bill first" (workSessions.ts 996-1013).
   - The Daily Summary template re-reads live logs, so the day rows change or fall back to one row per line (billSummary.ts 80) (B).
9. **Can a finalised bill be edited?** There is no finalised state. Any bill, including a PAID one, can be edited in every field, as long as the new total is not below the amount paid (bills.ts 742-926) (B).
10. **Cancellation:** there is no cancel or void. Only a hard delete, which also deletes its payments and frees its sessions. The audit keeps a snapshot (931-959) (B).
11. **Is previous bill information preserved?**
    - On edit: only in the AuditLog `before` snapshot (without the letterhead) (910-922). The letterhead is overwritten with the current settings, and the bill row and items are replaced.
    - On delete: the audit snapshot only.
    - There is no versioned or reprintable copy of the original invoice (C).
12. **How is outstanding updated?**
    - Synchronously, inside the same transaction as each payment add, edit or delete, and on bill edit, through `paidAmount` and `status` (1188-1196, 1254-1262, 1296-1304, 892-901).
    - Customer and dashboard figures are computed live from bills and payments plus unbilled work value (C13-C15) (B).

---

## 5. Scenario answers

| Scenario | Supported? | Behaviour / records affected | Evidence |
|---|---|---|---|
| Duplicate bill (double tap or retry) | Prevented | The same Idempotency-Key replays the stored response (`src/lib/idempotency.ts` 1-24; routes). Without a key (old apps), the session unique index still blocks a second normal bill. Summary and Direct bills without a key **can be duplicated** (no natural key). | B (normal), C (summary/direct) |
| Same sessions billed concurrently | Prevented | Lock + re-check + unique index → one wins, the other gets WORK_SESSION_ALREADY_BILLED | B (bills.ts 101-107, 449-460, 89-99) |
| Bill without all records | Allowed | Untick sessions. The rest stay unbilled and appear in the next picker. | B |
| Overlapping periods: normal vs normal | Prevented per session | Different sessions with overlapping dates can still be billed separately (no date-overlap check) | B |
| **Overlap: Direct bill vs session bill** | **Not prevented** | A Direct bill stores no BillItem, so the sessions and logs it covered remain "unbilled". They still appear in `listUnbilledWorkSessions` and can be billed again. The hours helper will also suggest the **same hours for a second Direct bill**. Site Analysis, customer pending and dashboard keep counting them as unbilled revenue, on top of the Direct bill total. | B (bills.ts 699-734 no items; 375 `billItems:none`; siteAnalysis 141, 164, 524-531; customers 83; dashboard 488-498) |
| **Overlap: Summary bill vs session bill** | **Not prevented** | Summary lines have workSessionId = null (540-543). The sessions remain billable and unbilled in every receivable figure. | B |
| Incorrect rate | Fix by editing | Edit the bill (per-line rates are editable even for linked lines). Payments are kept and status re-derived; a total below paid is refused. The letterhead is re-stamped. | B (752-926) |
| Rate change between work and billing | Silent mismatch | The form defaults to today's Site rate. Site Analysis values unbilled work at the rate in force on the work date. Once billed, Site Analysis uses the bill amount. | C (site-defaults 22-26; sites.ts 140; siteAnalysis 166-174) |
| Hours changed after invoice | Bill unchanged | The session update keeps the bill snapshot. Extra approved hours become unbillable through the normal flow. Session customer and site can be changed with no warning, so a bill for customer X can cover a session now owned by Y. | B (workSessions 902-991) |
| Bill cancelled after payments | Hard delete | The bill and all its payments are deleted (cascade). Money received disappears from "received" totals (dashboard 442-445). Sessions are freed. The audit holds a snapshot. No credit note. | B (931-959; schema 825) |
| Partial payment | Yes | PARTIAL, pending shown, more payments allowed | B |
| Excess payment | Refused | PAYMENT_EXCEEDS_BALANCE (server), HTML max (client), DB CHECK | B |
| Advance (before a bill exists) | No | A Payment requires a billId. The only "advance" is customer-supplied diesel netted on the bill. | B (schema 819) |
| Payment on the wrong bill | Manual fix | Delete it and re-add it on the correct bill. There is no move. Both actions are audited. | B |
| Reversal / refund / bounced cheque | No dedicated flow | Edit the amount down or delete the payment. No negative payments (amount ≥ 0.01 plus CHECK > 0). | B |
| One receipt, several invoices | No | One payment belongs to one bill. It must be split by hand into several payments. No receipt number or document. | B |
| Revenue recorded but not collected | Tracked | Revenue = Σ bill totals by billDate. Collected = Σ payments. Pending is shown per bill, per customer and on the dashboard. No ageing, due date or reminders. | B (dashboard 479-501) |
| Bill total edited below paid | Refused | BILL_TOTAL_BELOW_PAID | B (879-884) |
| Customer deleted with bills | Blocked by DB | Bill.customer is `onDelete: Restrict`; customers are archived instead | C (schema 773) |
| Bill-per-day limit | Enforced if set | Counted by createdAt since server-local midnight | C (148-160) |

---

## 6. Gaps (business-function risks)

- **G1 Direct bill does not consume work.**
  - The hours suggested by `/api/bills/direct/hours` stay "unbilled" after the Direct bill is created.
  - Effects: double billing through a normal or another Direct bill, and receivables and revenue that are overstated (Site Analysis, customers and dashboard all add unbilled work value on top of the Direct bill total).
  - Evidence: bills.ts 699-734; siteAnalysis 141, 164, 516-545; customers.ts 83; dashboard 497-498.
- **G2 Summary bill does not consume work.** Same double-count risk (bills.ts 540-543).
- **G3 Edits can move lines away from session truth.**
  - Linked line hours and rates can be edited.
  - Removing a linked line frees the session.
  - Changing the bill's customer keeps lines linked to the other customer's sessions; there is no check (bills.ts 764-776, 849-860).
- **G4 Session edits after billing.**
  - Allowed without a warning to the user. Customer, site and hours can change.
  - Extra approved logs on a billed session are never billable and are counted as revenue only through the billed amount share (workSessions 902-991).
- **G5 No cancellation or void.**
  - Delete erases payments and the invoice number history (only the audit log keeps them).
  - Not suitable for GST compliance; there are no credit or debit notes.
- **G6 Paid bills fully editable, including number, type, GST and customer.** The letterhead is re-stamped on edit, so a re-issued invoice silently differs from the copy sent earlier.
- **G7 Customer details and template not snapshotted.**
  - Customer name, address and mobile are live (toBillPreviewData 1100-1102).
  - The template is business-wide and live, and the Daily Summary rows are built from live logs.
- **G8 GST limits.**
  - No IGST or inter-state handling (igst is always null).
  - No HSN/SAC, place of supply or GSTIN format validation. Buyer GSTIN is not pre-filled from Customer.gstNumber in the normal and direct forms.
  - No GST number sequence; GST numbers are fully manual.
  - The API accepts any rate from 0 to 28, while the UI offers 5/12/18/28.
  - GST is charged before the diesel deduction (tax is not reduced by diesel). That may be intended, since diesel is treated as an advance (bills.ts 280-282).
- **G9 Normal bill uses one rate for all lines.** Mixed-tool or multi-site sessions get the same rate, and the default rate is today's, not the effective-dated one.
- **G10 Diesel litres on normal bills come from the client.** The server does not re-derive them from sessions (bills.ts 469). The Direct form cannot turn the diesel deduction off (form 116; vdb 335 default true).
- **G11 Payments.**
  - Method is free text.
  - No advance, unallocated or on-account payments, no multi-bill allocation, no receipts, no TDS, discount-on-settlement or write-off.
  - "Give Money" is hidden once pending ≤ 0.01.
- **G12 List and export filters.** No date, status or GST-type filter in the UI. The service and export support from/to, but the UI never sends them. Summary bills cannot be told apart from normal bills in filters.
- **G13 Per-bill Excel always uses the STANDARD layout** and never includes payments or status (D).
- **G14 Edit reason is never captured from the UI** (the API supports `reason`).
- **G15 maxBillsPerDay uses server-local midnight on createdAt.** The time zone is INFERRED, not verified.
- **G16 "Next bill number" preview is not reserved.** Deleted numbers leave gaps; there is no reuse and no warning.
- **G17 No due dates, ageing, reminders or statement of account per customer** (UNVERIFIED for a customer statement outside billing; none was found in the billing files).

---

## 7. Evidence index

- `prisma/schema.prisma`: Business billing fields 44-62; BankAccount 118-135; BillNumberSequence 700-710; Bill 716-787; BillItem 789-813; Payment 815-829.
- `prisma/migrations/20261004091000_security_and_integrity/migration.sql` 211-213: payment and paid CHECKs.
- `src/lib/money.ts`: round2 33, lineAmount 42, gstSplit 59-65, paymentStatus 69-73.
- `src/lib/services/bills.ts`:
  - Infrastructure: atomic 72-87, uniqueViolation 91-99, lockWorkSessions 104-107, lockOwnedBill 112-117, paidSum 119-125, checkDailyBillLimit 148-160.
  - Building blocks: buildLetterhead 162-185, number format 187-189, resolveBillNumber 200-219, readCharges 242-251, readDiesel 259-267, gstRate 269-271, normalBillTotals 275-296, checkTotal 300-306, buildSummaryLines 318-333, persistNewBill 339-359.
  - Reads for forms: listUnbilledWorkSessions 365-393, previewNextNonGstBillNumber 397-403.
  - Create: createBill 416-517, reserveBillNumber 523-538, createSummaryBill 544-614, directBillAmounts 618-657, createDirectBill 664-736.
  - Update and delete: updateBill 752-926, deleteBill 931-959.
  - Lists and detail: searchWhere 980-1001, listBills 1003-1031, listBillsForExport 1038-1055, countBillsByType 1065-1073, getBillDetail 1075-1086, toBillPreviewData 1095-1143.
  - Payments: addPayment 1160-1210, updatePayment 1214-1278, deletePayment 1280-1319.
- `src/lib/validation/bill.ts`: generateBillSchema 116-147, billItemInputSchema 163-176, generateSummaryBillSchema 182-204, updateBillSchema 214-242, payment schemas 248-270, billsExportQuerySchema 280-287, directBillHoursQuerySchema 301-308.
- `src/lib/validation/directBill.ts`: generateDirectBillSchema 321-362 (file lines 13-54).
- API routes:
  - `src/app/api/bills/route.ts` (POST 8-25, GET 27-46)
  - `direct/route.ts`, `direct/hours/route.ts`, `summary/route.ts`
  - `new/route.ts`, `new/direct/route.ts`, `new/summary/route.ts`, `preview-context/route.ts`
  - `[id]/route.ts` (GET template 20-27, PATCH, DELETE), `[id]/payments/route.ts`, `[id]/payments/[paymentId]/route.ts`
  - `[id]/export/route.ts`, `export/route.ts`
- `src/lib/services/billSummary.ts` 23-131 (Daily Summary rows).
- `src/lib/services/billExcel.ts`: buildBillWorkbook 93-396, register 398-516.
- `src/lib/services/siteAnalysis.ts`: entriesCte 97-187, getRecordedHoursForBilling 516-545.
- `src/lib/services/customers.ts`: listCustomers 49-96, summary 98-133, listCustomerOptions 171-178, getCustomerDetail 268-281.
- `src/lib/services/dashboard.ts` 433-501.
- `src/lib/services/financials.ts` 31-63.
- `src/lib/services/workSessions.ts`: updateWorkSession 902-994, deleteWorkSession 996-1013.
- `src/lib/services/sites.ts`: listSiteOptions 9-15, rate history 140-188.
- `src/lib/services/settings.ts`: updateBillTemplate 163, bank accounts 279-425.
- `src/lib/idempotency.ts` 1-24.
- `src/lib/api-auth.ts` 30-50.
- UI:
  - `src/app/(app)/bills/page.tsx` 20-34, 104-146; `bills-list.tsx` 80-117.
  - `new/page.tsx`; `new/generate-bill-form.tsx` 75-190, 405-470.
  - `new/direct/page.tsx`, `new/direct/generate-direct-bill-form.tsx` 70-155, 574-617, `new-customer-fields.tsx`.
  - `new/summary/page.tsx`, `edit/page.tsx` 58-99.
  - `detail/page.tsx` 40-134, `detail/payment-section.tsx` 30-272, `share-bill-button.tsx` 16-90, `print-button.tsx`, `export-register-button.tsx`.
- Components:
  - `src/components/bill/editor/bill-math.ts` 14-198, 276-299; `use-bill-editor.ts` 61-265; `site-defaults.ts` 14-38; `money-preview.ts` 14-41.
  - `bill-template-picker.tsx` 10-23; `use-idempotency-key.ts` 12-29; `editor/extra-charges.tsx` 18-30; `editor/diesel-fields.tsx`.
- `src/lib/bill-pdf.ts` 89-94; `src/lib/utils/numberToWords.ts` 41-49.
