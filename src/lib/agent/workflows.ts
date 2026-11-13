import { MORE_PROMPT_LANGS } from "./prompts";
import type { AppManifest, Workflow, WorkflowField } from "./types";

/**
 * The App Knowledge Map: what this app can actually do, written against the
 * screens the repository audit found. Nothing speculative is registered — a
 * workflow in here is one a person can already complete by hand.
 *
 * Deliberately NOT in here, because the app has no such screen:
 *  - machine expenses. ExcavatorExpense exists in the schema with no UI and no
 *    API route, so there is nothing to drive. Diesel is captured on a daily
 *    reading instead, and in LITRES — "2500 rupaye ka diesel" has to become a
 *    quantity before it means anything here.
 *  - origin/destination on a job. A work session has a single site.
 *  - an amount on a job. Money is derived from hours x the site's rate when a
 *    bill is made, so a job cannot be "added for 1200 rupees".
 *
 * Most forms are dialogs inside a page rather than their own route, so a
 * workflow is usually: navigate -> click `openWith` -> fill -> submit.
 */

/**
 * One field's question, in every language that has it.
 *
 * Still positional for English, Hindi and Marathi so the definitions below
 * read as prose; the other six are looked up by the English text in
 * prompts.ts. That keeps twenty workflow definitions legible instead of
 * burying each field under nine lines of script, and leaves one place to
 * review when a language is added. A prompt with no entry falls back to
 * English, which say() handles.
 */
const ask = (en: string, hi: string, mr: string) => ({ en, hi, mr, ...MORE_PROMPT_LANGS[en] });

/** Fields that name a record have to be resolved through the app's own picker;
 * the agent must never type a name straight into a hidden id. */
const operatorField = (control: string): WorkflowField => ({
  name: "operator",
  kind: "entity",
  entityKind: "operator",
  required: true,
  control,
  prompt: ask("Which operator?", "कौन सा ऑपरेटर?", "कोणता ऑपरेटर?"),
});

const machineField = (control: string): WorkflowField => ({
  name: "machine",
  kind: "entity",
  entityKind: "machine",
  required: true,
  control,
  prompt: ask("Which machine?", "कौन सी मशीन?", "कोणते मशीन?"),
});

export const WORKFLOWS: Workflow[] = [
  // --- read-only -----------------------------------------------------------
  {
    id: "machine.list",
    status: "ready",
    effect: "READ",
    summary: "List machines and their status.",
    route: "/excavators",
    fields: [],
    steps: [{ action: "navigate", route: "/excavators" }],
    verify: { control: "machine-list" },
  },
  {
    id: "machine.status.view",
    status: "ready",
    effect: "READ",
    summary: "One machine: status, hour meter, site, operator.",
    route: "/excavators/detail",
    fields: [machineField("machine-card")],
    steps: [
      { action: "navigate", route: "/excavators" },
      { action: "pickFromList", control: "machine-card", fromField: "machine" },
      { action: "waitFor", control: "machine-detail" },
    ],
    verify: { control: "machine-detail" },
  },
  {
    id: "machine.service.view",
    status: "ready",
    effect: "READ",
    summary: "One machine: service history and what is due.",
    route: "/excavators/detail",
    fields: [machineField("machine-card")],
    steps: [
      { action: "navigate", route: "/excavators" },
      { action: "pickFromList", control: "machine-card", fromField: "machine" },
      { action: "click", control: "tab-service" },
      { action: "waitFor", control: "service-tab" },
    ],
    verify: { control: "service-tab" },
  },
  {
    id: "operator.salary.view",
    status: "ready",
    effect: "READ",
    summary: "One operator: salary earned, paid and owed.",
    route: "/operators/detail",
    fields: [operatorField("operator-card")],
    steps: [
      { action: "navigate", route: "/operators" },
      { action: "pickFromList", control: "operator-card", fromField: "operator" },
      { action: "click", control: "tab-overview" },
      { action: "waitFor", control: "salary-summary" },
    ],
    verify: { control: "salary-summary" },
  },
  {
    id: "business.dashboard.view",
    status: "ready",
    effect: "READ",
    summary: "Dashboard: hours, revenue, received, pending.",
    route: "/dashboard",
    fields: [],
    steps: [{ action: "navigate", route: "/dashboard" }],
    verify: { control: "dashboard-cards" },
  },

  {
    id: "customer.list",
    status: "ready",
    effect: "READ",
    summary:
      "List customers with jobs, billed and owed.",
    route: "/customers",
    fields: [],
    steps: [{ action: "navigate", route: "/customers" }],
    verify: { control: "customer-list" },
  },
  {
    id: "operator.list",
    status: "ready",
    effect: "READ",
    summary: "List operators and which machine each is on.",
    route: "/operators",
    fields: [],
    steps: [{ action: "navigate", route: "/operators" }],
    verify: { control: "operator-list" },
  },
  {
    id: "bill.list",
    status: "ready",
    effect: "READ",
    summary: "List bills and what is unpaid.",
    route: "/bills",
    fields: [],
    steps: [{ action: "navigate", route: "/bills" }],
    verify: { control: "bill-list" },
  },
  {
    id: "site.list",
    status: "ready",
    effect: "READ",
    summary: "List sites with hours, revenue and pending.",
    route: "/site-analysis",
    fields: [],
    steps: [{ action: "navigate", route: "/site-analysis" }],
    verify: { control: "site-list" },
  },
  {
    id: "site.analysis.view",
    status: "ready",
    effect: "READ",
    summary:
      "One site: machines, hours, diesel, revenue, pending.",
    route: "/site-analysis",
    fields: [
      {
        name: "site",
        kind: "entity",
        entityKind: "site",
        required: true,
        control: "site-card",
        prompt: ask("Which site?", "कौन सी साइट?", "कोणती साईट?"),
      },
    ],
    steps: [
      { action: "navigate", route: "/site-analysis" },
      { action: "pickFromList", control: "site-card", fromField: "site" },
      { action: "waitFor", control: "site-summary" },
    ],
    verify: { control: "site-summary" },
  },
  {
    // "tumne kya kiya?" — the owner checking up on the thing that acts for
    // them. A read with no values, so it is tappable too, which matters:
    // wanting to know what it did is most likely right after it did something
    // surprising.
    id: "assistant.history.view",
    status: "ready",
    effect: "READ",
    summary: "What the assistant saved recently, and if it worked.",
    route: "/settings/assistant",
    fields: [],
    steps: [{ action: "navigate", route: "/settings/assistant" }],
    verify: { control: "assistant-history" },
  },
  {
    id: "approvals.view",
    status: "ready",
    effect: "READ",
    summary:
      "What is waiting for approval: joins, readings, jobs.",
    route: "/operators/approvals",
    fields: [],
    steps: [{ action: "navigate", route: "/operators/approvals" }],
    verify: { control: "approvals-list" },
  },

  // --- writes --------------------------------------------------------------
  {
    // The app's own word for this is a "trip" (customers list counts jobs as
    // trips), so "trip add karo" lands here.
    id: "work.start",
    status: "ready",
    effect: "WRITE",
    summary: "Start a job: customer, site, starting hour meter.",
    route: "/excavators/detail",
    openWith: "start-work-trigger",
    fields: [
      machineField("machine-card"),
      {
        name: "customer",
        kind: "entity",
        entityKind: "customer",
        required: true,
        control: "customerId",
        // Defaulted from the site when the site already has one, so this is
        // only asked when the app genuinely does not know.
        prompt: ask("Which customer?", "कौन सा ग्राहक?", "कोणता ग्राहक?"),
      },
      {
        name: "site",
        kind: "text",
        required: true,
        control: "siteName",
        prompt: ask("Which site?", "कौन सी साइट?", "कोणती साईट?"),
      },
      {
        name: "startHourMeter",
        kind: "hours",
        required: true,
        control: "startHourMeter",
        prompt: ask(
          "What is the hour meter reading now?",
          "अभी घंटा मीटर कितना है?",
          "आता तास मीटर किती आहे?",
        ),
      },
      {
        name: "startDate",
        kind: "date",
        required: false,
        control: "startDate",
        prompt: ask("Which day did it start?", "किस दिन शुरू हुआ?", "कोणत्या दिवशी सुरू झाले?"),
      },
    ],
    steps: [
      { action: "navigate", route: "/excavators" },
      { action: "pickFromList", control: "machine-card", fromField: "machine" },
      { action: "click", control: "start-work-trigger" },
      // Site BEFORE customer, and the order is load-bearing. Typing a site
      // re-answers the customer question in the dialog's own logic (a site
      // already belongs to a customer), so it clears whatever customer was
      // chosen. Selecting the customer first meant it was silently replaced by
      // the site's owner — the job went to the wrong name — or, for a site the
      // app had never seen, left blank so the form refused to submit at all.
      // Caught by tests/agent/real-forms.test.tsx against the real dialog.
      { action: "fill", control: "siteName", fromField: "site" },
      { action: "select", control: "customerId", fromField: "customer" },
      { action: "fill", control: "startHourMeter", fromField: "startHourMeter" },
      // Optional: skipped when unsaid, so the form keeps its own default of today.
      { action: "fill", control: "startDate", fromField: "startDate" },
      { action: "submit", control: "start-work-submit" },
    ],
    verify: { control: "active-work-card" },
    // No cancel control is registered because the dialog has no dedicated
    // cancel button — it closes by its own X. Cancelling before submission is
    // handled as a task transition, not a click.
  },
  {
    id: "reading.add",
    status: "ready",
    effect: "WRITE",
    summary: "Add a day to a running job: meter, diesel.",
    route: "/excavators/detail",
    openWith: "add-reading-trigger",
    fields: [
      machineField("machine-card"),
      {
        name: "date",
        kind: "date",
        required: true,
        control: "date",
        prompt: ask("Which day?", "किस दिन का?", "कोणत्या दिवसाचे?"),
      },
      {
        name: "endHourMeter",
        kind: "hours",
        required: true,
        control: "endHourMeter",
        prompt: ask(
          "What was the hour meter at the end?",
          "काम के बाद घंटा मीटर कितना था?",
          "काम झाल्यावर तास मीटर किती होते?",
        ),
      },
      {
        name: "dieselLiters",
        kind: "number",
        required: false,
        // Litres, not rupees — the app records diesel as a quantity.
        control: "dieselLiters",
        prompt: ask("How many litres of diesel?", "कितने लीटर डीज़ल?", "किती लिटर डिझेल?"),
      },
    ],
    steps: [
      { action: "navigate", route: "/excavators" },
      { action: "pickFromList", control: "machine-card", fromField: "machine" },
      { action: "click", control: "add-reading-trigger" },
      { action: "fill", control: "date", fromField: "date" },
      { action: "fill", control: "endHourMeter", fromField: "endHourMeter" },
      // Optional: skipped when no diesel was mentioned, so the box stays empty
      // rather than being zeroed.
      { action: "fill", control: "dieselLiters", fromField: "dieselLiters" },
      { action: "submit", control: "add-reading-submit" },
    ],
    verify: { control: "readings-list" },
  },
  {
    id: "work.stop",
    status: "ready",
    effect: "WRITE",
    summary: "Finish a job, with its final hour meter.",
    route: "/excavators/detail",
    openWith: "stop-work-trigger",
    fields: [
      machineField("machine-card"),
      {
        name: "endHourMeter",
        kind: "hours",
        required: true,
        control: "stop-endHourMeter",
        prompt: ask(
          "What is the final hour meter reading?",
          "आख़िरी घंटा मीटर कितना है?",
          "शेवटचे तास मीटर किती आहे?",
        ),
      },
      {
        name: "endDate",
        kind: "date",
        required: false,
        control: "stop-endDate",
        prompt: ask("Which day did it finish?", "किस दिन खत्म हुआ?", "कोणत्या दिवशी संपले?"),
      },
    ],
    steps: [
      { action: "navigate", route: "/excavators" },
      { action: "pickFromList", control: "machine-card", fromField: "machine" },
      { action: "click", control: "stop-work-trigger" },
      { action: "fill", control: "stop-endHourMeter", fromField: "endHourMeter" },
      // Optional: left alone when unsaid, so the form keeps its own default of
      // the day the job started.
      { action: "fill", control: "stop-endDate", fromField: "endDate" },
      { action: "submit", control: "stop-work-submit" },
    ],
    // The active-job card disappearing is what proves the job ended, so this
    // one is checked by the machine page settling rather than a card appearing.
    verify: { control: "machine-detail" },
  },
  {
    id: "machine.allocate_operator",
    status: "ready",
    effect: "WRITE",
    summary: "Put an operator on a machine.",
    route: "/excavators/detail",
    openWith: "assign-operator-trigger",
    fields: [machineField("machine-card"), operatorField("assign-operator-select")],
    steps: [
      { action: "navigate", route: "/excavators" },
      { action: "pickFromList", control: "machine-card", fromField: "machine" },
      { action: "click", control: "assign-operator-trigger" },
      { action: "select", control: "assign-operator-select", fromField: "operator" },
      { action: "submit", control: "assign-operator-submit" },
    ],
    verify: { control: "current-operator" },
  },

  {
    id: "operator.leave.add",
    status: "ready",
    effect: "WRITE",
    summary: "Record leave: days off, paid or unpaid.",
    route: "/operators/detail",
    openWith: "add-leave-trigger",
    fields: [
      operatorField("operator-card"),
      {
        name: "fromDate",
        kind: "date",
        required: true,
        control: "leaveStart",
        prompt: ask("From which day?", "किस दिन से?", "कोणत्या दिवसापासून?"),
      },
      {
        // Required by the form, and a single day off is the common case — but
        // it is still asked rather than assumed, because quietly copying the
        // start date would book leave the owner never said.
        name: "toDate",
        kind: "date",
        required: true,
        control: "leaveEnd",
        prompt: ask("Until which day?", "किस दिन तक?", "कोणत्या दिवसापर्यंत?"),
      },
      {
        // Left out means the form's own default of unpaid stands, which is the
        // conservative reading: paid leave costs the owner money.
        name: "leaveType",
        kind: "select",
        required: false,
        control: "leaveType",
        prompt: ask("Paid or unpaid?", "पेड या अनपेड?", "पगारी की बिनपगारी?"),
      },
    ],
    steps: [
      { action: "navigate", route: "/operators" },
      { action: "pickFromList", control: "operator-card", fromField: "operator" },
      { action: "click", control: "tab-sessions" },
      { action: "waitFor", control: "sessions-panel" },
      { action: "click", control: "add-leave-trigger" },
      { action: "fill", control: "leaveStart", fromField: "fromDate" },
      { action: "fill", control: "leaveEnd", fromField: "toDate" },
      { action: "select", control: "leaveType", fromField: "leaveType" },
      { action: "submit", control: "add-leave-submit" },
    ],
    verify: { control: "leaves-list" },
  },
  {
    id: "customer.create",
    status: "ready",
    effect: "WRITE",
    summary: "Add a customer: name and phone.",
    route: "/customers/new",
    fields: [
      {
        name: "name",
        kind: "text",
        required: true,
        control: "new-customer-name",
        prompt: ask("What is the customer's name?", "ग्राहक का नाम क्या है?", "ग्राहकाचे नाव काय?"),
      },
      {
        // A spoken ten-digit number is the single easiest thing to mishear, so
        // this one earns its place on the approval card above all the others —
        // the owner hears it read back before anything is written.
        name: "mobile",
        kind: "text",
        required: true,
        control: "new-customer-mobile",
        prompt: ask("What is their phone number?", "उनका फ़ोन नंबर क्या है?", "त्यांचा फोन नंबर काय?"),
      },
    ],
    steps: [
      { action: "navigate", route: "/customers/new" },
      { action: "fill", control: "new-customer-name", fromField: "name" },
      { action: "fill", control: "new-customer-mobile", fromField: "mobile" },
      { action: "submit", control: "new-customer-submit" },
      { action: "waitFor", control: "customer-detail" },
    ],
    verify: { control: "customer-detail" },
  },

  // --- registered, deliberately not offered --------------------------------
  // These are drafts: resolve() will not return them and the model is never
  // told they exist, so asking for one gets an honest "the app can't do that
  // by voice". They are written down here so the reason is on the record
  // rather than rediscovered.
  {
    // The form will not submit until at least one part is ticked from a
    // searchable catalogue of components, each with its own quantity and cost.
    // Picking parts from a spoken sentence means guessing at a cost that goes
    // against a machine's history, and the owner cannot read the result back
    // to catch it. A service is recorded by hand.
    id: "service.record.add",
    status: "draft",
    effect: "WRITE",
    summary: "Record a completed service on a machine, with the parts replaced.",
    route: "/excavators/detail",
    openWith: "add-service-trigger",
    fields: [machineField("machine-card")],
    steps: [{ action: "navigate", route: "/excavators" }],
    verify: { control: "service-tab" },
  },
  {
    // A bill is the one document here that leaves the business, and it is made
    // over several screens: which completed jobs to include, the rates that
    // applied, which bank account, then a summary to check. Driving that for
    // someone who cannot read the total back is the highest-risk thing the
    // assistant could do, and the lowest-value: bills are made sitting down.
    // The assistant lists bills and reads what is unpaid instead.
    id: "bill.create",
    status: "draft",
    effect: "SENSITIVE",
    summary: "Make a bill for a customer from their completed jobs.",
    route: "/bills/new",
    fields: [],
    steps: [{ action: "navigate", route: "/bills/new" }],
    verify: { control: "bill-list" },
  },

  // --- sensitive -----------------------------------------------------------
  {
    // Money against a person's name. Always confirmed, whatever the amount.
    id: "operator.transaction.add",
    status: "ready",
    effect: "SENSITIVE",
    summary: "Money for an operator: advance, payment, bonus, deduction.",
    route: "/operators/detail",
    openWith: "add-transaction-trigger",
    fields: [
      operatorField("operator-card"),
      {
        name: "amount",
        kind: "money",
        required: true,
        control: "amount",
        prompt: ask("How much?", "कितने रुपये?", "किती रुपये?"),
      },
      {
        name: "category",
        kind: "select",
        required: true,
        control: "categoryId",
        prompt: ask("What is it for?", "किस लिए?", "कशासाठी?"),
      },
      {
        name: "date",
        kind: "date",
        required: true,
        control: "date",
        prompt: ask("Which day?", "किस दिन का?", "कोणत्या दिवसाचे?"),
      },
    ],
    steps: [
      { action: "navigate", route: "/operators" },
      { action: "pickFromList", control: "operator-card", fromField: "operator" },
      { action: "click", control: "add-transaction-trigger" },
      { action: "select", control: "categoryId", fromField: "category" },
      { action: "fill", control: "amount", fromField: "amount" },
      { action: "fill", control: "date", fromField: "date" },
      { action: "submit", control: "add-transaction-submit" },
    ],
    verify: { control: "transactions-list" },
  },
];

export const APP_MANIFEST: AppManifest = {
  manifestVersion: 1,
  // Bumped with the app: a manifest built against another build must not drive
  // this one, because its control ids may no longer exist.
  appVersion: "0.1.0",
  routes: [
    { path: "/dashboard", feature: "dashboard", requires: "owner" },
    { path: "/excavators", feature: "machines", requires: "owner" },
    { path: "/excavators/detail", feature: "machine detail", requires: "owner" },
    { path: "/operators", feature: "operators", requires: "owner" },
    { path: "/operators/detail", feature: "operator detail", requires: "owner" },
    { path: "/site-analysis", feature: "site analysis", requires: "owner" },
    { path: "/bills", feature: "bills", requires: "owner" },
    { path: "/customers", feature: "customers", requires: "owner" },
  ],
  workflows: WORKFLOWS,
};
