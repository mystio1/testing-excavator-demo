# 08 — Real-World Scenarios and Exceptions

This document records how the application actually behaves in difficult operating situations. Everything below comes from reading the implementation. No transactions were created and no application was run.

**Columns:**
- **Supported?** — does the application handle this situation?
- **Actual behaviour** — what it does.
- **Records affected** — which records change.
- **Propagates?** — whether other modules update.
- **Business consequence** — what it means for the business.
- **Ev.** — the evidence grade:
  - B = traced end to end
  - C = partly traced
  - D = inferred
  - E = unverified

Detailed evidence for each row is in the deep dive named in brackets:
- [01] Machines
- [02] Work and diesel
- [03] Operators
- [04] Billing
- [05] Customers and reports

## 1. Machine scenarios

| Scenario | Supported? | Actual behaviour | Records affected | Propagates? | Business consequence | Ev. |
|---|---|---|---|---|---|---|
| Same machine assigned to two active sites | Not prevented | A machine has one *current site* and at most one active job. The job carries its own site, and the two are never synchronised. If the current site is A and the job is at B, "Machines working" counts the machine at **both** A and B. One machine can never have two active jobs. [01 S1] | Excavator.currentSiteId, WorkSession.siteId | Site Analysis counts | Machine counts per site can be overstated | B |
| Machine unavailable when work is requested | No availability concept | Start Work is refused only if the machine already has an active job, an operator job in progress or pending, or no assigned operator. Servicing, archiving or breakdown do not block it. [01 F10] | — | — | A machine under repair can be put to work in the records | B |
| Machine moves from one site to another | Yes | Site card "Change": the machine's current site changes, and optionally the old site's status is set in the same step (audited). The new site's status is untouched. A running job keeps its old site, so its hours stay at the old site. Operator-job approval also moves the machine's site, without asking about the old site. [01 F9, 05 S6] | Excavator, old Site.status | Site Analysis "machines at site" | History is preserved per job; the move itself is only in the audit log | B |
| Machine replaced during an active assignment | Partial (manual) | There is no replace function. Stop the job on machine A, assign the operator to machine B (which ends A's assignment), and start a new job on B. A job cannot be moved to another machine. [01 S3] | OperatorAssignment, WorkSession | — | Two separate jobs; the customer billing is split across them | B |
| Machine breaks down during a shift | Not supported as a concept | No breakdown status or downtime record. The workaround is Stop Work, then add a Service record and/or a REPAIR expense, with notes. The "Under Service" count stays 0. [01 S4] | WorkSession, ServiceRecord, Expense | Profit (cost) | Downtime is not measured; availability is not visible | B |
| Machine becomes inactive with historical transactions | Yes (archive) | Archive is a flag only. History, bills, services and expenses remain (a hard delete is impossible). There is **no check** for an active job, a pending operator job or an assigned operator. The operator portal can keep starting jobs on it. It is hidden from lists but reachable by link. There is no restore. [01 F3, S5] | Excavator.isArchived | Lists and counts drop it; Profit still includes its costs | "Inactive" machines can keep accumulating records | B |
| Historical machine information changes | Yes | Name, number, brand, model, purchase date and service interval are editable; the starting meter and status are not. **Old bills display the new name and number** (not frozen). Service-due is recalculated immediately. [01 S6] | Excavator | Bills (display), service alerts | Reprinted invoices differ from the originals | B |

## 2. Working-hour scenarios

| Scenario | Supported? | Actual behaviour | Records affected | Propagates? | Consequence | Ev. |
|---|---|---|---|---|---|---|
| Missing meter entry | Not detected | No reminder and no missing-day check. A reading can be added late only while the job is **active**. If the job has no readings at all, the stop meter difference covers the whole job. [02 S1, S8] | DailyWorkLog, WorkSession | Hours re-summed | Gaps are silent; missing days are folded into the job total or lost | B |
| Incorrect opening reading | Accepted | Only "end > start" is checked within one reading. No comparison with the previous closing or with the machine meter. Start Work with a lower meter **winds the machine meter back**. [02 S9, F1] | Excavator.currentHourMeter | Service due | Wrong maintenance alerts; disputable hours | B |
| Incorrect closing reading | Accepted if > start | Stop Work only checks end > job start, not ≥ the last daily reading. The owner can edit readings and jobs afterwards. [02 F2, F7, F9] | WorkSession, DailyWorkLog | Hours, meter | — | B |
| Duplicate daily reading | Blocked (same job and day) | One live reading per job per date (database-enforced): "Hours for this date are already logged…" / "A reading for this date is already submitted". The same meter range on different dates is **not** detected. Overlapping operator jobs are not detected. [02 S10] | — | — | Double counting is possible across dates or operator jobs | B |
| Reading entered late / backdated | Yes | Any past date is accepted. **Future dates are accepted** for owner and operator readings. A backdated reading does not move the meter unless it is the latest by date. [02 S11] | DailyWorkLog | Hours | — | B |
| Different operator on the same machine | Partial | One assigned operator per machine and one operator per job (snapshotted at start). After reassignment the new operator can submit readings, but they are credited to the job's original operator. The owner's free-text "operator name" on a reading is the only per-day override. Two shifts by two operators on one day cannot be recorded separately. [02 S4, S18] | WorkSession.operatorId | Operator ranking | Operator hours attribution is approximate | B/C |
| Meter replacement / reset | No dedicated flow | The starting meter cannot be edited after creation and there is no meter-change event. The workaround is Start Work with the new (lower) meter, which silently rewinds the machine meter. [02 S5] | Excavator.currentHourMeter | Service due distorted | Service history comparisons break | C |
| Work across midnight | Yes | Clock mode adds 24 h when the stop time is earlier than the start time. The hours land on the reading's (start) date. [02 S2] | DailyWorkLog | — | — | B |
| Machine changes site during a day | No (within one job) | A job has one site. You need Stop plus a new Start (a second job), or a job edit that moves **all** its hours. [02 S3] | WorkSession | Site Analysis | — | B |
| Part shift | Yes, as hours | Clock mode with a break, or a meter difference. There is no shift or minimum-hours concept. [02 S6] | DailyWorkLog | — | — | B |
| Working-hour correction after invoicing | Allowed, not locked | Jobs and readings on a billed job can be edited, deleted or approved. The bill keeps its snapshot. Extra hours become **unbillable** through the normal bill. Only deleting a billed job is refused ("This work is already on a bill — edit or delete that bill first"). [02 S12, 04 Q8] | WorkSession, DailyWorkLog (BillItem unchanged) | Site Analysis hours change, billed revenue does not | Bills and work records drift apart | B |
| Operator approval out of order | Defect | If an operator starts a new job while an older one is pending, approving the older one sets the machine to **Idle** and its meter to the old end reading while the new job runs. [02 S19] | Excavator | Meter, status, service due | Wrong status and meter | B (verified by the main investigator) |

## 3. Diesel scenarios

| Scenario | Supported? | Actual behaviour | Records affected | Consequence | Ev. |
|---|---|---|---|---|---|
| Multiple diesel entries on one day | Limited | One reading per job per day holds one litre figure. A second diesel-only entry on the same day is refused ("A diesel entry for this date is already submitted"). A diesel-only entry on a day that already has a work reading is refused ("…add the diesel to that day's reading instead"). Two fills must be added up by hand. [02 S13] | DailyWorkLog | Fill-level detail is lost | B |
| Wrong quantity entered | Correctable | The owner edits the litres on a work reading (the job total adjusts), or deletes a diesel-only entry. **Editing a reading erases its "litres left in tank".** [02 S14, G4] | DailyWorkLog, WorkSession | The diesel average chain is broken | B |
| Wrong machine selected | No move | Delete and re-enter. An operator can only record diesel for their own assigned machine. [02 S14] | — | — | B |
| Diesel entered without a working record | Partial | The operator's diesel-only entry attaches to the active job, or else to the **most recent job of any status** (possibly completed, billed, or for another customer). With no previous job: "No previous work found for this machine". The owner side has no diesel-only entry. [02 S15] | DailyWorkLog on a past job | Diesel lands on the wrong customer or job, possibly after billing | B |
| Diesel cost changes | Partial | The Settings diesel price is used **live** for profit costing. Changing it re-costs every past period that has no DIESEL expense. A bill's diesel rate is typed per bill and is frozen on the bill. [05 F16] | Business.dieselPricePerLitre | Past profit restated | B |
| Fuel balance becomes negative | Prevented in inputs, flagged in reports | "Litres left" ≥ 0. When previous closing + filled − closing < 0, the Daily Reading row is flagged and its average left blank. There is no tank capacity or running stock. [02 S16] | — | — | B |
| Purchase and consumption records do not reconcile | Not supported | There is no purchase ledger to reconcile against. DIESEL expenses (amount only) and litres on work records are unrelated, except that the expense replaces litres × price in profit. [02 G6] | — | No fuel-theft or variance control | B |

## 4. Operator scenarios

| Scenario | Supported? | Actual behaviour | Records affected | Consequence | Ev. |
|---|---|---|---|---|---|
| Operator leaves an assignment | Yes (machine side) | "End" on the machine's operator card: the assignment is ENDED with today's date and the machine has no operator. Salary and working period are unaffected. An active job keeps its operator. [03 S1] | OperatorAssignment, Excavator | No new owner jobs until a new operator is assigned | B |
| New operator replaces an existing operator | Yes | Assigning B ends A's assignment on that machine. Jobs already running stay credited to A. The change cannot be backdated. [03 S2] | OperatorAssignment, Excavator | Hours after the swap are credited to A until a new job starts | C |
| Operator works on multiple machines | No (one at a time) | Assigning an operator to a machine ends their other assignment and clears that machine's operator. [03 S3] | OperatorAssignment | — | B |
| Operator attendance is missing | No attendance module | Salary accrues every calendar day of an active working period, whatever work was logged. Absence must be entered as unpaid leave. [03 S4] | — | Salary may be paid for days not worked | B |
| Salary is partially paid | Yes | Record a "Salary Payment" transaction of any amount; the remainder stays owed. There is no payroll run or payslip. [03 S5] | OperatorTransaction | — | B |
| Advance remains outstanding | Implicit | A "deduct" advance reduces what is owed. If it exceeds earnings, the balance goes negative. A **negative balance is not carried** to the next session (it stays on the old one). An advance not marked "deduct" is never recovered or tracked. [03 S6] | — | Recoverable advances can be forgotten | C |
| Salary record is corrected | Partial | Salary is never stored; it is recalculated live. Corrections are made by editing or deleting transactions or leaves, or by editing salary, which **rewrites the whole current session at the new rate**. A closed session's rate cannot be edited. Past figures change silently (audited). [03 S7, S8] | OperatorTransaction, Leave, WorkingPeriod | Past salary views and profit change | B |
| Operator archived with a balance | Allowed | No balance check. The operator disappears from salary due and profit, including past months. [03 S9] | Operator.isArchived | Owed salary vanishes from totals | B |
| Operator rejoins after a break | Yes | "Start New Session": the old session closes, the gap becomes leave (unpaid by default, optionally paid), a new salary can be set, and a positive balance must be carried forward or kept separate. [03 S10] | WorkingPeriod, Leave | — | B |

## 5. Billing scenarios

| Scenario | Supported? | Actual behaviour | Records affected | Consequence | Ev. |
|---|---|---|---|---|---|
| Duplicate bill | Prevented for normal bills | The same request retried returns the first bill (idempotency key). Two normal bills cannot contain the same job (row lock, plus a database unique rule): "One or more selected work records have already been billed". **Summary and Direct bills can be duplicated** freely. [04 §5] | — | — | B / C |
| Bill generated without all working records | Allowed | Untick jobs; the rest stay unbilled for the next bill. [04 §5] | — | — | B |
| Billing period overlaps | Partly prevented | Normal vs normal: protected per job, but jobs with overlapping dates can sit on different bills. **Direct or Summary vs normal: not prevented**, so the same hours can be billed twice. [04 G1, G2] | — | Double invoicing (GAP-001) | B |
| Incorrect rate | Fix by editing | Edit the bill: line rates are editable and payments kept; a total below the amount paid is refused. The letterhead is refreshed. [04 §5] | Bill, BillItem | — | B |
| Working hours changed after invoice | Bill unchanged | See section 2. [04 Q8] | — | — | B |
| Bill cancelled after payments | Hard delete only | Delete removes the bill **and its payments**; the jobs become billable again. "Amount Received" drops. There is no credit note. [04 F10] | Bill, BillItem, Payment (deleted) | Cash history lost (audit log only) | B |
| Multiple bills for one site | Yes | Bills are per customer; a site is just a label on each line. [04 Q5] | — | — | B |
| Partially completed assignment | Partial | Only **completed** jobs can go on a normal bill. To bill mid-way, stop the job and start a new one, or use a Direct bill (which suggests hours from the active job) or a Summary bill. Neither marks the hours as billed. [04 Q6] | — | See GAP-001 | C |

## 6. Payment scenarios

| Scenario | Supported? | Actual behaviour | Consequence | Ev. |
|---|---|---|---|---|
| Partial payment | Yes | The bill becomes PARTIAL and further payments are allowed. | — | B |
| Excess payment | Refused | "Amount exceeds the pending balance of ₹X" (also blocked by the database). | Overpayment must be recorded off-system | B |
| Advance received | Not supported | A payment needs a bill. | Advance must wait for a bill or be kept off-system | B |
| Payment entered against the wrong bill | Manual fix | Delete it and add it to the correct bill (both audited). There is no "move". | — | B |
| Payment against the wrong customer | Same as above | — | — | B |
| Payment reversal (bounced cheque, refund) | No dedicated flow | Edit the amount down or delete the payment. No negative payments. | No trace of the bounce in reports | B |
| Cancelled invoice with an existing payment | — | See "Bill cancelled after payments": the payments are deleted with the bill. | — | B |
| One receipt settling several invoices | Not supported | Split by hand into one payment per bill. There is no receipt number or document. | — | B |

## 7. Financial scenarios

| Scenario | Supported? | Actual behaviour | Consequence | Ev. |
|---|---|---|---|---|
| Expense recorded twice | Not prevented | No duplicate guard; both count in profit until one is deleted. [01 S9] | Profit understated | B |
| Expense changed after reporting | Delete only, live effect | There is no expense edit. Delete plus re-add restates past profit immediately. There is no period close. [01 S10, 05 S11] | Previously reported profit changes | B |
| Maintenance expense attached to the wrong machine | Expense: delete and re-create. **Service record: cannot be corrected at all.** [01 S7] | — | Machine history wrong permanently | B |
| Site expenses not allocated | Not possible | No expense has a site. There is no site-level cost or profit. [05 S7] | — | B |
| Bill totals differ from financial report totals | Expected, by design and by defect | The Revenue card = invoices (with GST). Profit revenue = work value (without GST) plus charges. Site revenue = work-linked lines only. Direct and Summary bill hours are double-counted in "Total" and "Pending". See 10_REPORTS_AND_FINANCIAL_RECONCILIATION.md. | Figures do not tie out | B |
| Revenue recorded but not collected | Tracked | Pending per bill, per customer and on the dashboard. No ageing or due dates. The overdue widget is not displayed. [05 S9] | — | B |
| Cash received but not allocated to a bill | Impossible | Every payment must be allocated to exactly one bill. [05 S10] | — | B |
