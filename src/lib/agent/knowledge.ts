/**
 * What the assistant knows about the app itself.
 *
 * The router model is told which capabilities exist and nothing else, so a
 * question like "how do I bill a customer?" or "why is pending so high?" could
 * only end in "I can't do that" — or, worse, a confident invention about an app
 * it has never seen. This is the guide it answers those questions from.
 *
 * Where it comes from: the functional audit of the product
 * (excavator-manager/docs/excavator-functional-audit/), re-checked against THIS
 * codebase. This build is older than the audited one, so the entries describe
 * what is actually here. In particular:
 * - there is no Expenses page and no diesel price setting;
 * - there is no bill-template choice;
 * - profit is "this month's bills minus service cost and salary";
 * - sites have three statuses.
 * When the app changes, the entry that describes the change has to change with
 * it: an out-of-date sentence here becomes a wrong answer spoken to an owner
 * who has no way to check it.
 *
 * Rules for writing an entry, because each one is read to the model verbatim:
 * - Facts only, in plain words. Say how to do it (which screen, which button)
 *   and what the app does with it.
 * - Say what the app does NOT do, where people would expect it. "There is no
 *   cancel button" is a far better answer than a made-up menu path.
 * - Keep each one short. Only the best few are sent per question, and the
 *   whole answer is spoken aloud.
 * - `keywords` are the words an owner would actually use, including Hinglish
 *   (Latin) and Devanagari. Matching folds both scripts the same way
 *   (see script.ts), so one spelling of each is enough.
 */

import { comparable } from "./script";

export type KnowledgeEntry = {
  id: string;
  title: string;
  keywords: string[];
  body: string;
};

export const KNOWLEDGE: KnowledgeEntry[] = [
  // --- the app as a whole ----------------------------------------------------
  {
    id: "app.overview",
    title: "What the app does and its main screens",
    keywords: ["app", "overview", "features", "menu", "screens", "kya hai", "kaise kaam", "modules", "navigation", "tabs"],
    body:
      "The app runs an excavator hire business. The menu has Home (dashboard), Machines, Customers, Operators, Bills, Approvals, Site Analysis, Diesel Checker and Settings. " +
      "You add machines, operators, customers and sites; record each job and its daily hours and diesel; bill customers from completed work; record payments; record machine services; and manage operator salary and advances. " +
      "Operators have their own portal on their phone to send readings, which you approve.",
  },
  {
    id: "app.not-available",
    title: "Things this version of the app does not have",
    keywords: ["expense", "kharcha", "kharch", "fuel purchase", "diesel stock", "attendance", "hajri", "overtime", "staff login", "accountant", "cancel bill", "credit note", "igst", "advance payment", "nahi hai", "missing"],
    body:
      "Not available in this version:\n" +
      "- an Expenses page for repairs or other costs;\n" +
      "- diesel purchase or stock records;\n" +
      "- operator attendance and overtime;\n" +
      "- daily, shift or monthly hire rates (only hourly rates);\n" +
      "- bill cancellation, credit notes and IGST;\n" +
      "- customer advance payments not tied to a bill;\n" +
      "- staff or accountant logins (one owner login per business).\n" +
      "Machine breakdown status is also missing: the \"Under Service\" status is shown but nothing sets it.",
  },
  {
    id: "assistant.what-it-can-do",
    title: "What the assistant can do",
    keywords: ["assistant", "tum kya kar sakte", "help", "madad", "voice", "bolkar", "kya kar sakta"],
    body:
      "The assistant can fill in common forms for you by voice or text: start or stop work on a machine, add a day's reading with diesel, record an operator advance or payment, check a machine's service due or status, and similar tasks. " +
      "It always shows what it will save and waits for your yes, and it only says something is saved after the screen shows it. " +
      "It can also explain how any part of the app works. It cannot create bills or service records by voice; it can tell you the steps.",
  },

  // --- machines --------------------------------------------------------------
  {
    id: "machine.add",
    title: "Adding a machine",
    keywords: ["add machine", "new machine", "machine jodna", "jcb add", "excavator add", "machine banao", "starting meter", "naya machine"],
    body:
      "To add a machine:\n" +
      "1. Go to Machines and tap Add Machine.\n" +
      "2. Enter its name, and optionally its number, brand, model and purchase date.\n" +
      "3. Enter the starting hour meter. This is required and cannot be changed later.\n" +
      "4. Optionally enter a service interval in hours. If left blank, the business default from Settings is used (350 hours unless changed).\n" +
      "The machine starts as Idle. Next, assign an operator to it from the machine page.",
  },
  {
    id: "machine.status",
    title: "Machine status: Idle, Working, Under Service",
    keywords: ["status", "idle", "working", "under service", "chalu", "band", "breakdown", "kharab", "repair", "available"],
    body:
      "A machine is Working while it has a running job and Idle otherwise. Start Work makes it Working; Stop Work, or approving an operator's job, makes it Idle. " +
      "The \"Under Service\" status exists on screen but nothing in the app sets it, so the dashboard count for it stays 0. There is no breakdown status. " +
      "For a breakdown, stop the job and record the repair with Add Service on the machine's Service tab.",
  },
  {
    id: "machine.archive",
    title: "Deleting or archiving a machine",
    keywords: ["delete machine", "remove machine", "archive", "hatao", "machine delete", "sold", "becha", "restore"],
    body:
      "Deleting a machine only hides it from lists; its jobs, bills and service history are kept. It cannot be restored afterwards. " +
      "The app does not stop you deleting a machine that is working or has an operator assigned, so stop its job and end the operator assignment first.",
  },
  {
    id: "machine.operator",
    title: "Assigning or changing a machine's operator",
    keywords: ["assign operator", "operator change", "operator badlo", "driver", "chalak", "operator lagana", "end assignment"],
    body:
      "On the machine page, use the Assigned Operator card to Assign or Change the operator, or End the assignment. " +
      "A machine has one operator and an operator is on one machine at a time; assigning them to another machine removes them from the first. " +
      "The change takes effect today and cannot be back-dated. A job that is already running keeps the operator it started with. " +
      "A machine needs an assigned operator before you can Start Work on it.",
  },
  {
    id: "machine.site",
    title: "Setting where a machine is (current site)",
    keywords: ["machine site", "move machine", "site change", "shift", "machine kaha hai", "location", "transfer"],
    body:
      "On the machine page, the Site card shows the machine's current site. Use Set or Change to pick a site, or type a new name, which creates the site. " +
      "This does not move a job that is already running; the job keeps its own site. To move work to a new site, stop the job and start a new one at the new site. " +
      "Approving an operator's job also updates the machine's site.",
  },
  {
    id: "machine.hour-meter",
    title: "How the machine hour meter changes",
    keywords: ["hour meter", "meter", "reading", "ghanta meter", "current meter", "meter galat", "meter wrong", "meter reset"],
    body:
      "The machine's meter is set from the work you record:\n" +
      "- Start Work sets it to the opening reading.\n" +
      "- Each approved daily reading on a running job sets it to that reading.\n" +
      "- Stop Work sets it to the closing reading.\n" +
      "- A service record raises it if its reading is higher.\n" +
      "The app does not check that a new opening matches the last closing. Typing a lower opening reading moves the meter backwards, so check the number before saving. " +
      "The starting meter of a machine cannot be edited, and there is no meter-replacement option.",
  },
  {
    id: "machine.performance",
    title: "Machine performance (earnings per machine)",
    keywords: ["machine performance", "machine kamai", "earning", "kitna kamaya", "machine revenue", "best machine"],
    body:
      "The Machines page shows earnings and hours per machine by day, week, month or year. Earnings are the value of the work: billed work at its billed amount, and unbilled work at the site's hourly rate. " +
      "This shows revenue only, not profit; machine costs are not taken off.",
  },

  // --- work, readings, hours --------------------------------------------------
  {
    id: "work.start",
    title: "Starting work (a job) on a machine",
    keywords: ["start work", "kaam shuru", "kaam chalu", "job start", "machine chalu karo", "shuru karo", "new job"],
    body:
      "On the machine page, tap Start Work and choose the customer, the site (type a new name to create it), the start date, the opening hour meter and the tool (Bucket, Breaker or Chaining). " +
      "The machine needs an assigned operator. The job becomes active, the machine shows Working, and the operator is recorded on the job. " +
      "You cannot start a second job on the same machine until the first is stopped.",
  },
  {
    id: "work.stop",
    title: "Stopping work (completing a job)",
    keywords: ["stop work", "kaam band", "job khatam", "complete job", "rok do", "finish", "closing meter", "end meter"],
    body:
      "On the machine page, tap Stop Work and enter the end date and the closing hour meter, which must be higher than the opening meter. Diesel filled, diesel left in the tank and notes are optional. " +
      "If the job has approved daily readings, its hours are the sum of those readings; otherwise they are closing meter minus opening meter. " +
      "The job becomes Completed, the machine Idle, and the job can now be billed.",
  },
  {
    id: "work.daily-reading",
    title: "Recording a day's work (daily reading)",
    keywords: ["daily reading", "aaj ka kaam", "daily log", "reading add", "ghante", "hours add", "todays work", "roz ka", "entry"],
    body:
      "While a job is running, open the machine's Work tab and use Add Today's Work. Enter the date, then either the start and end meter, or the start and stop time with a break. Diesel filled, the tool and notes are optional. " +
      "Only one reading per job per date is allowed, and hours must be more than 0. Readings you add are approved immediately; readings an operator sends wait for your approval. " +
      "Readings cannot be added after a job is stopped.",
  },
  {
    id: "work.hours-calculation",
    title: "How hours are calculated",
    keywords: ["hours calculation", "ghante kaise", "kitne ghante", "hours kaise nikle", "time", "break", "midnight", "decimal"],
    body:
      "You never type hours; the app works them out:\n" +
      "- Meter mode: hours = end meter − start meter.\n" +
      "- Time mode: hours = stop time − start time − break minutes. Work past midnight is handled.\n" +
      "Hours are decimals, so 7.5 means 7 hours 30 minutes, and they are rounded to 2 places. " +
      "A job's total is the sum of its approved readings, or the meter difference if it has none.",
  },
  {
    id: "work.correct",
    title: "Correcting or deleting readings and jobs",
    keywords: ["edit reading", "galat reading", "wrong hours", "correct", "sudhar", "delete reading", "edit job", "delete job", "mistake"],
    body:
      "From the machine's Work or History tab you can edit or delete any reading, and edit a job's customer, operator, site, dates, meters and diesel. " +
      "A job that is already on a bill cannot be deleted, but it can still be edited. The bill does not change when you edit it, so fix the bill separately.\n" +
      "Careful:\n" +
      "- Editing a reading clears its \"diesel left in tank\" figure.\n" +
      "- Editing a job's diesel replaces its diesel total with the number you type.",
  },

  // --- operator portal and approvals -----------------------------------------
  {
    id: "portal.operator",
    title: "Operator portal (operator's phone)",
    keywords: ["operator portal", "operator app", "operator login", "pin", "operator phone", "operator kya kar sakta"],
    body:
      "Operators log in at the operator login page with their mobile number and PIN. They see only their assigned machine. " +
      "If you started the job, they can send each day's reading and diesel. If no job is running, they can start and end their own job with meter readings, the tool and the site. " +
      "Nothing they send counts until you approve it in Approvals. You choose the portal language in Settings; each operator can also pick their own.",
  },
  {
    id: "approvals",
    title: "Approvals: operator readings and jobs",
    keywords: ["approve", "approval", "pending", "reject", "manjoor", "operator reading approve", "waiting", "accept"],
    body:
      "The Approvals page lists:\n" +
      "- readings and diesel entries operators have sent;\n" +
      "- jobs operators have finished;\n" +
      "- requests from new operators to join.\n" +
      "Approving a reading adds its hours and diesel to the job. Rejecting a reading stores no reason, and the operator can send it again. " +
      "To approve an operator's job, choose or add the customer and check the site, meters and dates; it then becomes a completed job you can bill. Rejecting a job lets you add a note for the operator.",
  },
  {
    id: "approvals.operator-job-issues",
    title: "Problems with operator-started jobs",
    keywords: ["operator job stuck", "cannot start work", "start work blocked", "operator ne shuru kiya", "in progress", "cancel operator job", "meter reset"],
    body:
      "While an operator's own job is in progress or waiting for approval, you cannot start work on that machine yourself. There is no way for you to cancel an operator's unfinished job; the operator has to end it. " +
      "Approving an operator's job sets the machine to Idle and its meter to that job's closing reading. If the operator has already started a newer job, check the machine's meter after approving.",
  },

  // --- diesel -----------------------------------------------------------------
  {
    id: "diesel.recording",
    title: "Recording diesel",
    keywords: ["diesel", "fuel", "dizel", "diesel dala", "litre", "tank", "diesel entry", "diesel only"],
    body:
      "Diesel is recorded in litres with the work: on a daily reading, at Stop Work, or by the operator as a \"Diesel only\" entry. Operators can also record the litres left in the tank. " +
      "Only one reading per job per date is allowed, so two fills on the same day must be added together. " +
      "An operator's \"Diesel only\" entry goes to the running job; if none is running, it goes to the machine's most recent job, so check which job it landed on. " +
      "There is no record of diesel bought, its price or stock.",
  },
  {
    id: "diesel.average",
    title: "Diesel average and the Diesel Checker",
    keywords: ["diesel average", "average", "kitna diesel", "per hour", "litre per hour", "diesel checker", "mileage", "consumption", "chori"],
    body:
      "Site Analysis shows diesel used and the average in litres per hour for each site and machine. Where the tank level was recorded, it uses (previous tank + filled − tank now) ÷ hours, and it flags a day that comes out negative. " +
      "The Diesel Checker page is a quick calculator: enter total hours, diesel taken and diesel left, and it shows the average and how many hours the remaining diesel will last. It saves nothing.",
  },
  {
    id: "diesel.customer-supplied",
    title: "Diesel supplied by the customer (diesel advance on a bill)",
    keywords: ["customer diesel", "diesel advance", "diesel minus", "diesel kata", "party ne diesel diya", "deduct diesel"],
    body:
      "If the customer gave the diesel, enter its litres and price per litre on the bill. The app subtracts litres × price from the bill total as a \"diesel advance\". " +
      "On a normal bill the litres are added up from the selected jobs. This deduction is taken after GST, so GST is still charged on the full work amount.",
  },

  // --- maintenance -------------------------------------------------------------
  {
    id: "service.add",
    title: "Recording a service or repair",
    keywords: ["service", "add service", "servicing", "repair", "maintenance", "oil change", "parts", "service entry", "service kiya"],
    body:
      "To record a service:\n" +
      "1. Open the machine, go to the Service tab and tap Add Service.\n" +
      "2. Enter the date and the hour meter at service.\n" +
      "3. Tick each part worked on, with what was done (serviced, replaced, repaired, and so on), its cost and its brand.\n" +
      "Parts not done last time are pre-ticked. Use Add New Component if a part is missing from the list. " +
      "A service record cannot be edited or deleted later, so check the meter reading and costs before saving. Recording a service does not mark the machine unavailable.",
  },
  {
    id: "service.due",
    title: "When the next service is due, and service alerts",
    keywords: ["service due", "next service", "service kab", "overdue", "alert", "350", "service interval", "notification"],
    body:
      "Next service = the last service's meter reading (or the starting meter) + the machine's service interval (business default 350 hours). " +
      "If a part with its own shorter interval was serviced (for example greasing or bucket teeth at 50 hours), the next service is set from that shorter interval. " +
      "You get an alert when service is due within the threshold in Settings (default 50 hours) or overdue. Change the defaults in Settings → Business Profile.",
  },

  // --- customers and sites ------------------------------------------------------
  {
    id: "customer.manage",
    title: "Adding, editing and deleting customers",
    keywords: ["customer", "add customer", "grahak", "party", "client", "customer edit", "delete customer", "customer hatao"],
    body:
      "Go to Customers and tap Add Customer. Name and mobile are required; company, address and GST number are optional. You can also add a customer while starting work or making a bill. " +
      "Editing a customer's name, address or phone also changes how old bills show them. " +
      "Deleting a customer only hides them, and they cannot be restored. The app does not warn you if they still owe money.",
  },
  {
    id: "customer.pending",
    title: "Customer total and pending amount",
    keywords: ["customer pending", "baki", "baaki", "udhaar", "kitna dena hai", "outstanding", "due", "customer total", "whatsapp reminder"],
    body:
      "A customer's Pending = (their bill totals − payments received) + the value of approved work not billed yet, priced at the site's hourly rates. " +
      "So pending can include work you have not invoiced yet. The \"Work not billed yet\" card on the customer page shows that part. The WhatsApp reminder button sends this same pending figure. " +
      "For only what has been invoiced, look at each bill's pending amount.",
  },
  {
    id: "site.manage",
    title: "Sites: creating, customer site vs self site, status",
    keywords: ["site", "create site", "new site", "site status", "completed site", "self site", "on hold", "site band"],
    body:
      "Create a site from Site Analysis → Create Site. Enter the name (it must be unique), its type (Customer Site needs a customer, Self Site does not), the location, the status and the hourly rates. " +
      "A site is also created automatically when you type a new site name while starting work; it then has no customer and no rates until you add them. " +
      "Status (Active, Completed, On Hold) is only a label. It does not stop work or bills at that site.",
  },
  {
    id: "site.rates",
    title: "Site hourly rates and changing them",
    keywords: ["rate", "rate change", "bucket rate", "breaker rate", "per hour rate", "bhav", "kiraya", "rent", "effective from"],
    body:
      "Each site has a Bucket rate and a Breaker rate per hour. To change them, open the site in Site Analysis and use the rates card with an \"Effective from\" date (it cannot be in the future). " +
      "Unbilled work is valued at the rate in force on the day it was done. Bills already made never change. Chaining and other tools have no rate. " +
      "Old rate entries cannot be edited; add a new rate to correct one. Only hourly rates exist: no daily, shift or monthly hire.",
  },
  {
    id: "site.analysis",
    title: "Site Analysis report",
    keywords: ["site analysis", "site report", "site hisab", "site wise", "daily machine reading", "share report", "site pdf"],
    body:
      "Site Analysis lists every site with its hours, value, money received and pending. You can filter by type, status, machine and dates. " +
      "A site's page shows Bucket and Breaker hours, diesel used and averages, each machine's work, and a day-by-day machine reading table, which flags readings where the end is lower than the start. " +
      "Share sends a PDF of the site report. Values use approved work only: billed work at its billed amount, unbilled work at the site rate.",
  },

  // --- bills ---------------------------------------------------------------------
  {
    id: "bill.types",
    title: "The three kinds of bill",
    keywords: ["bill", "invoice", "bill types", "kaunsa bill", "summary bill", "direct bill", "normal bill", "bill banao"],
    body:
      "From the Bills page you can make three kinds of bill:\n" +
      "1. Generate Bill: bills completed jobs you pick. This is the usual way, and it marks those jobs as billed.\n" +
      "2. Summary bill: you type each line yourself (machine, site, dates, hours, rate).\n" +
      "3. Direct bill: one machine's Bucket and Breaker hours for a period, typed by hand.\n" +
      "Summary and Direct bills are not linked to your recorded jobs. Those jobs still show as \"not billed\", so do not bill the same hours again with Generate Bill.",
  },
  {
    id: "bill.generate",
    title: "How to generate a bill from completed work",
    keywords: ["generate bill", "bill kaise banaye", "bill banana", "banate", "banaye", "banau", "make bill", "create bill", "invoice banao", "customer bill", "bill steps", "बिल बनवा"],
    body:
      "To bill completed work:\n" +
      "1. On Bills, tap Generate Bill.\n" +
      "2. Pick the customer, and optionally a site, machine or dates.\n" +
      "3. Completed jobs that are not yet billed are listed and ticked; untick any you do not want.\n" +
      "4. Enter the rate per hour. It is pre-filled from the site's current rate and applies to every line.\n" +
      "5. Add any transport, fuel or extra charges, a discount, and customer diesel.\n" +
      "6. Choose Non-GST or GST (with rate and buyer GSTIN), and the bank account.\n" +
      "Running jobs cannot be billed; stop them first. A billed job cannot be billed again.",
  },
  {
    id: "bill.calculation",
    title: "How a bill total and GST are calculated",
    keywords: ["bill total", "gst", "cgst", "sgst", "tax", "calculation", "kaise calculate", "discount", "transport", "amount"],
    body:
      "The total is built up like this:\n" +
      "- Each line = hours × rate.\n" +
      "- Taxable = sum of lines + transport + fuel + extra charges − discount. A direct bill uses lines + transport only.\n" +
      "- GST = taxable × GST rate, split equally into CGST and SGST. There is no IGST for other states.\n" +
      "- Total = taxable + GST − customer diesel advance.\n" +
      "Amounts are rounded to the paisa.",
  },
  {
    id: "bill.numbering",
    title: "Bill numbers",
    keywords: ["bill number", "invoice number", "ng-", "gst bill number", "numbering", "series"],
    body:
      "Non-GST bills are numbered automatically: NG-0001, NG-0002 and so on, unless you choose to enter a number yourself. " +
      "GST bills always need a number typed by hand; the app has no automatic GST series. Every bill number must be unique. A deleted bill's number is not reused.",
  },
  {
    id: "bill.edit-delete",
    title: "Editing, cancelling or deleting a bill",
    keywords: ["edit bill", "bill change", "cancel bill", "delete bill", "bill galat", "bill sudhar", "credit note", "bill hatao"],
    body:
      "Any bill can be edited at any time, even after payment, but its new total cannot be less than what has already been paid. Editing also refreshes the letterhead and bank details from Settings. " +
      "There is no cancel or credit note. Deleting a bill removes it permanently together with all its payments, and its jobs can be billed again.",
  },
  {
    id: "bill.share",
    title: "Printing, sharing and exporting bills",
    keywords: ["print bill", "share bill", "whatsapp bill", "pdf", "excel", "export", "download bill", "bill bhejo"],
    body:
      "Open a bill to print it, share it as a PDF on WhatsApp (the message includes the balance due), or download it as Excel. " +
      "On the Bills page, Export downloads all bills as an Excel register with total, paid, pending and status. You can filter the list by All, Generated by App or Self Generated, and search it. " +
      "Your logo, signature, business details and bank details come from Settings and are saved onto each bill when it is made.",
  },

  // --- payments ---------------------------------------------------------------------
  {
    id: "payment.record",
    title: "Recording a customer payment",
    keywords: ["payment", "paisa aaya", "payment receive", "give money", "jama", "received", "partial payment", "paid", "unpaid"],
    body:
      "Open the bill and tap Give Money. Enter the amount (it starts as the full pending amount), the date, the method (for example cash, UPI or bank) and notes. " +
      "You can record several part payments. The amount cannot be more than what is pending. The bill shows Unpaid, Partial or Paid automatically.",
  },
  {
    id: "payment.correct",
    title: "Correcting payments, advances and receipts",
    keywords: ["wrong payment", "payment edit", "payment delete", "advance", "extra payment", "galat bill pe payment", "receipt", "refund", "multiple bills"],
    body:
      "Edit or delete a payment from the bill's payment list. To move a payment to the right bill, delete it and add it on the correct bill. " +
      "Every payment must belong to one bill and cannot be more than its balance. So there is no customer advance before a bill exists, and no overpayment. One cheque for several bills has to be split by hand into one payment per bill. " +
      "The app does not print receipts.",
  },

  // --- operators and salary -------------------------------------------------------
  {
    id: "operator.add",
    title: "Adding operators and the join request",
    keywords: ["add operator", "new operator", "operator jodna", "driver add", "join request", "business code", "operator signup"],
    body:
      "Go to Operators and tap Add Operator. Enter the name and mobile, and optionally the address, joining date and monthly salary. Salary starts from the joining date. " +
      "An operator can instead request to join from the operator signup page, using your Business Code from Settings. You approve the request in Approvals by typing the 6-digit code the operator sees. " +
      "An operator approved this way starts with salary 0, so set their salary afterwards.",
  },
  {
    id: "operator.portal-access",
    title: "Giving an operator portal access (PIN)",
    keywords: ["operator pin", "portal access", "login dena", "pin reset", "operator login band"],
    body:
      "On the operator's page, the portal card lets you turn portal login on with a 4 to 8 digit PIN, reset the PIN, or turn login off. " +
      "Turning login off or resetting the PIN signs the operator out everywhere. Deleted operators cannot log in.",
  },
  {
    id: "salary.how",
    title: "How operator salary is calculated",
    keywords: ["salary", "tankha", "pagar", "vetan", "salary kaise", "kitni salary", "remaining payable", "monthly salary", "payable"],
    body:
      "Salary is monthly only. It builds up day by day from the joining date: each month adds the monthly salary, and part of a month counts pro rata. " +
      "Remaining = salary earned + bonuses − deductions − salary paid. Unpaid leave reduces it. " +
      "Hours worked and attendance do not change salary. There is no attendance, overtime, hourly or daily wage.",
  },
  {
    id: "salary.screens-differ",
    title: "Why the Overview and Salary tabs show different amounts",
    keywords: ["salary different", "salary mismatch", "overview vs salary", "salary galat", "do alag amount", "salary tab"],
    body:
      "The two tabs use different rules. The Overview tab counts salary day by day up to today. The Salary tab counts the full monthly salary for every month, including the joining month and the current month. " +
      "So the Salary tab can show more. For the amount actually owed today, use the Overview (\"Since Joining\") or the Sessions tab.",
  },
  {
    id: "operator.money",
    title: "Advances, bonuses and salary payments to operators",
    keywords: ["advance", "operator advance", "udhaar diya", "bonus", "salary payment", "salary diya", "deduct", "katna", "transaction", "money tab"],
    body:
      "On the operator's Money tab, use Add Money Transaction. Choose a category, the amount, the date, how it affects the business account, and whether to deduct it from salary.\n" +
      "- Salary Payment reduces what you owe.\n" +
      "- Bonus / Incentive increases it.\n" +
      "- Anything else marked \"deduct\" (such as an advance) is taken off the salary owed. Unmarked, it does not affect salary.\n" +
      "Transactions can be edited or deleted later.",
  },
  {
    id: "operator.sessions-leave",
    title: "Leave, breaks and re-joining (sessions)",
    keywords: ["leave", "chutti", "rajja", "break", "rejoin", "wapas aaya", "session", "start new session", "close session", "unpaid leave", "paid leave"],
    body:
      "Use Record Leave on the operator's Sessions tab. Unpaid leave reduces salary; paid leave does not. " +
      "If an operator stops working, close their session with Close Session. When they return, use Start New Session: the gap is recorded as leave, and you can set a new salary. " +
      "If money was still owed, you choose to carry it forward or keep it separate.",
  },
  {
    id: "operator.delete",
    title: "Deleting an operator",
    keywords: ["delete operator", "remove operator", "operator hatao", "operator chhod diya", "left job"],
    body:
      "Deleting an operator hides them, blocks their login and removes them from salary totals; their history is kept. The app does not check whether salary is still owed, and the operator cannot be restored. " +
      "Settle their balance and end their machine assignment first.",
  },

  // --- dashboard and money reports ------------------------------------------------
  {
    id: "dashboard.cards",
    title: "Dashboard figures: Revenue, Received, Total, Pending",
    keywords: ["dashboard", "home", "revenue", "amount received", "total amount", "pending amount", "kitna aaya", "kamai", "hisab"],
    body:
      "The Home dashboard shows:\n" +
      "- Revenue: bills made this month, including GST.\n" +
      "- Amount Received: all payments recorded so far.\n" +
      "- Total Amount: all bills ever, plus approved work not yet billed (valued at site rates).\n" +
      "- Pending Amount: Total Amount − Amount Received.\n" +
      "It also shows hours worked, salary due, top customers, trends and alerts.",
  },
  {
    id: "dashboard.profit",
    title: "How profit is calculated",
    keywords: ["profit", "fayda", "munafa", "nafa", "loss", "nuksan", "profit kaise", "margin", "business profit"],
    body:
      "Business Profit on the dashboard covers the current month. Revenue is the total of bills made this month, including GST. Expenses are service costs recorded this month plus operator salary (monthly salary + bonuses). " +
      "Profit = revenue − expenses. Diesel, repairs outside service records, operator advances and work not yet billed are not counted, so treat it as an estimate.",
  },
  {
    id: "reports.mismatch",
    title: "Why figures differ between screens",
    keywords: ["mismatch", "different", "match nahi", "alag", "galat total", "pending different", "hours different", "reconcile"],
    body:
      "Different screens measure different things:\n" +
      "- Dashboard Revenue is bills made this month, including GST.\n" +
      "- Site Analysis values approved work by work date, excluding GST and bill charges, and does not include Summary or Direct bills.\n" +
      "- Customer and dashboard Pending include work not billed yet.\n" +
      "- Dashboard hours can include readings still waiting for approval.\n" +
      "Hours put on a Summary or Direct bill still count as unbilled work, so they can be counted twice.",
  },

  // --- settings and account --------------------------------------------------------
  {
    id: "settings",
    title: "Settings",
    keywords: ["settings", "letterhead", "logo", "signature", "bank account", "business profile", "gst number", "operator language", "business code"],
    body:
      "Settings contains:\n" +
      "- Business Profile: name, owner, phone, address, GST number, default service interval and alert threshold.\n" +
      "- Bill Letterhead: logos, signature, tagline and colour.\n" +
      "- Bank Accounts: add accounts and set the default for GST and for Non-GST bills. You can add or delete accounts here, not edit them.\n" +
      "- Operator Language.\n" +
      "- Business Code: share it with operators so they can join.\n" +
      "- App Lock PIN, Change Password and Sign Out Everywhere.",
  },
  {
    id: "account.login",
    title: "Login, password and users",
    keywords: ["login", "password", "forgot password", "password bhool", "reset", "user", "staff", "accountant", "app lock"],
    body:
      "You log in with your email or phone and password. Use Forgot Password on the login page to get a reset link by email. " +
      "Each business has a single owner login; there are no staff or accountant logins. Operators use the separate operator login with mobile and PIN. " +
      "App Lock in Settings adds a 4 or 6 digit PIN to reopen the app on this phone.",
  },
];

// --- retrieval -------------------------------------------------------------------

/** Words that say nothing about which topic is meant. Folded with the same
 * rules as everything else, so the Hinglish fillers match however they come. */
const STOP = new Set(
  [
    "a", "an", "the", "is", "are", "was", "to", "of", "in", "on", "for", "and", "or", "it", "my", "me", "i",
    "do", "does", "how", "what", "why", "when", "can", "this", "that", "with", "be", "app",
    "kya", "kaise", "kyu", "kyon", "hai", "hain", "ka", "ki", "ke", "ko", "me", "mein", "se", "aur", "ye", "yeh",
    "kar", "karo", "karna", "karte", "kaun", "kab", "mera", "meri", "apna", "hota", "hoti", "nahi", "bata", "batao",
    "kasa", "kay", "ahe", "aahe", "la", "chi", "cha", "che", "mala", "sang", "sanga",
    // Words that turn up in every kind of sentence, business or not. Measured:
    // "aaj mausam kaisa hai" matched the daily-reading entry on "aaj", "tell me a
    // joke" matched the assistant entry on "tell", and "who won the match"
    // matched the reports entry on "match". Phrases that contain them ("aaj ka
    // kaam", "match nahi") still score through the phrase check below.
    "today", "aaj", "kal", "now", "abhi", "tell", "show", "sunao", "dikhao", "who", "kaun", "won", "match",
    "please", "plz", "ji", "bhai", "sir",
  ].map((w) => comparable(w)),
);

function tokens(text: string): string[] {
  return comparable(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    // A crude plural/inflection fold — "bills" and "bill", "readings" and
    // "reading" — applied to both sides like every other rule here.
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
}

type Indexed = { entry: KnowledgeEntry; strong: Map<string, number>; weak: Map<string, number>; len: number };

function count(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of list) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/**
 * Built once. Title and keywords are the "strong" field: they are written to
 * be matched, so a hit there says far more than the same word somewhere in a
 * paragraph of explanation.
 */
const INDEX: Indexed[] = KNOWLEDGE.map((entry) => {
  const strong = tokens(`${entry.title} ${entry.keywords.join(" ")}`);
  const weak = tokens(entry.body);
  return { entry, strong: count(strong), weak: count(weak), len: weak.length };
});
const AVG_LEN = INDEX.reduce((a, d) => a + d.len, 0) / INDEX.length;

/** In how many entries each term appears, for the rarity weight. */
const DF = (() => {
  const df = new Map<string, number>();
  for (const d of INDEX) {
    for (const t of new Set([...d.strong.keys(), ...d.weak.keys()])) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return df;
})();

const STRONG_WEIGHT = 3;
const K1 = 1.2;
const B = 0.75;

export type KnowledgeHit = { entry: KnowledgeEntry; score: number };

/**
 * The best few entries for a question, BM25-scored.
 *
 * Plain keyword scoring rather than embeddings, deliberately. There are about
 * fifty short entries; a vector index would add a service, a cost per query
 * and a second model to keep in step, to rank a list a person can read in a
 * minute. What actually decides quality here is the query: the router model
 * hands over the question restated in English (`topic`), which is the
 * "translate the code-mixed query first" approach that works best for
 * Hinglish retrieval, and the owner's own words are scored alongside it so
 * nothing they said is lost in that restatement.
 *
 * Multi-word keywords also score as a phrase, because "start work" and
 * "stop work" share a word and mean opposite things.
 */
export function searchKnowledge(queries: string[], limit = 3): KnowledgeHit[] {
  const terms = [...new Set(queries.flatMap(tokens))];
  if (terms.length === 0) return [];
  const N = INDEX.length;
  const folded = queries.map((q) => ` ${comparable(q)} `).join(" ");

  const scored = INDEX.map((d) => {
    let score = 0;
    for (const t of terms) {
      const df = DF.get(t);
      if (!df) continue;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const tf = (d.strong.get(t) ?? 0) * STRONG_WEIGHT + (d.weak.get(t) ?? 0);
      if (tf === 0) continue;
      score += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * d.len) / AVG_LEN)));
    }
    for (const k of d.entry.keywords) {
      const phrase = comparable(k);
      // A phrase made only of filler ("kya hai", "how to") says nothing about
      // the topic, so it earns no bonus however exactly it matches. Measured:
      // "cricket score kya hai" reached the threshold on "kya hai" alone.
      if (phrase.includes(" ") && tokens(k).length > 0 && folded.includes(` ${phrase} `)) score += 2.5;
    }
    return { entry: d.entry, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, limit);
}

/**
 * Below this, the best entry is a coincidence of one common word, and an
 * answer built on it would be an invention with a citation attached. Saying
 * "I don't have that in the guide" is the honest result. Set from the test
 * questions in tests/agent/knowledge.test.ts: every real question there
 * clears it comfortably, and unrelated ones ("weather", "cricket score") do not.
 */
export const MIN_SCORE = 2.5;

/** The entries that are good enough to answer from: the best one must clear
 * the bar, and the others must be at least a third as relevant as the best, so
 * a strong match is not diluted by two weak ones. */
export function relevantKnowledge(queries: string[], limit = 3): KnowledgeEntry[] {
  const hits = searchKnowledge(queries, limit);
  const best = hits[0];
  if (!best || best.score < MIN_SCORE) return [];
  return hits.filter((h) => h.score >= best.score / 3).map((h) => h.entry);
}
