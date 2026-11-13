import { z } from "zod";

/**
 * Shared types for the in-app AI operator.
 *
 * The split that matters: Grok may PROPOSE an action, but nothing here trusts
 * it. Every proposal is parsed by these schemas, resolved against the workflow
 * registry and cleared by the policy engine before any UI is touched. A model
 * that returns an unknown workflow id, an extra field or a "confirmed: true"
 * flag gets rejected by construction rather than by a prompt asking it not to.
 */

/**
 * Languages the assistant answers in. Mixed/transliterated input is understood
 * as well — this is only what we speak back.
 *
 * Re-exported from i18n.ts, which also carries how a string gets into them and
 * which languages a speaker has actually checked. Kept exported from here
 * because most of the agent already imports its types from this file.
 */
export { AGENT_LANGS, type AgentLang } from "./i18n";
import type { AgentLang, Localized } from "./i18n";

/**
 * Task lifecycle. Transitions are enforced in task-state.ts, not by whoever
 * happens to be writing to the task — a model that claims SUCCEEDED cannot put
 * the task there, because only the verifier's result can.
 */
export const TASK_STATES = [
  "IDLE",
  "UNDERSTANDING",
  "RESOLVING_WORKFLOW",
  "COLLECTING_DETAILS",
  "READY_FOR_CONFIRMATION",
  "EXECUTING",
  "VERIFYING",
  "SUCCEEDED",
  "FAILED",
  "NEEDS_RECOVERY",
  "CANCELLED",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

/** What a workflow does to the business, which is what decides whether the
 * owner has to approve it before it runs. */
export type WorkflowEffect = "READ" | "WRITE" | "SENSITIVE";

/** How the browser-side controller is allowed to touch a control. Deliberately
 * closed: there is no "runScript", so a model cannot ask for one. */
export const UI_ACTIONS = [
  "navigate",
  "click",
  "fill",
  "select",
  /** Choose one record from a rendered list by its visible label. */
  "pickFromList",
  "waitFor",
  "read",
  "submit",
] as const;
export type UiAction = (typeof UI_ACTIONS)[number];

export type FieldKind = "text" | "number" | "date" | "money" | "hours" | "select" | "entity";

/** One input a workflow needs before it can run. `entityKind` marks the fields
 * that name a real record (an operator, a machine) and therefore have to be
 * resolved to one through the app's own pickers rather than typed blind. */
export type WorkflowField = {
  name: string;
  kind: FieldKind;
  required: boolean;
  /** data-agent-id of the control that holds it. */
  control: string;
  /** Asked verbatim when the field is missing, in each supported language. */
  /** Asked verbatim when the field is missing. English required, other
   * languages filled in as a speaker confirms them (see i18n.ts). */
  prompt: Localized;
  entityKind?: "operator" | "machine" | "customer" | "site";
};

export type WorkflowStep =
  | { action: "navigate"; route: string }
  | { action: "click"; control: string }
  | { action: "fill"; control: string; fromField: string }
  | { action: "select"; control: string; fromField: string }
  /** `control` is the repeated item (every machine card, every operator row);
   * the one whose label matches the field's value is clicked. Two matches is a
   * question for the user, never a coin toss. */
  | { action: "pickFromList"; control: string; fromField: string }
  | { action: "waitFor"; control: string }
  | { action: "submit"; control: string };

/**
 * A registered way to do one thing through the existing UI. The agent never
 * works out how to do a task; it looks it up here. `verify` is what makes a
 * success claim honest — until that control appears, the task is VERIFYING,
 * never SUCCEEDED.
 */
export type Workflow = {
  id: string;
  effect: WorkflowEffect;
  /**
   * "ready" means every control this workflow names is actually annotated in
   * the app, enforced by a test. A "draft" is registered and reviewable but
   * never offered to the model and never executable, so the agent can grow one
   * workflow at a time without a half-wired one reaching an owner.
   */
  status: "ready" | "draft";
  /** One line, in the compact catalogue Grok sees. No UI detail. */
  summary: string;
  /** Page the work starts on. Most forms here are dialogs inside a page, so
   * `openWith` is the control that opens the form once the page is loaded. */
  route: string;
  openWith?: string;
  fields: WorkflowField[];
  steps: WorkflowStep[];
  /** Control whose presence means the app actually did it. */
  verify: { control: string };
  /** Control that abandons the form without writing anything. */
  cancel?: { control: string };
};

/** The versioned map of the app the registry is written against. A manifest
 * built for a different app version must not be used to drive this one. */
export type AppManifest = {
  manifestVersion: number;
  appVersion: string;
  routes: { path: string; feature: string; requires: "owner" | "operator" }[];
  workflows: Workflow[];
};

// --- model-facing schemas -------------------------------------------------

/** The only shapes Grok is allowed to return. `.strict()` throughout: an extra
 * key is a rejected response, not a silently ignored one. */
export const proposedActionSchema = z
  .object({
    kind: z.literal("action"),
    workflowId: z.string().min(1),
    /** Raw values as understood from speech; still unresolved and unvalidated. */
    fields: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  })
  .strict();

export const clarificationSchema = z
  .object({
    kind: z.literal("clarify"),
    /** Which field the question is about, when it is about one. */
    field: z.string().optional(),
    question: z.string().min(1),
  })
  .strict();

export const replySchema = z
  .object({
    kind: z.literal("reply"),
    message: z.string().min(1),
  })
  .strict();

export const agentResponseSchema = z.discriminatedUnion("kind", [
  proposedActionSchema,
  clarificationSchema,
  replySchema,
]);

export type ProposedAction = z.infer<typeof proposedActionSchema>;
export type AgentResponse = z.infer<typeof agentResponseSchema>;

/** A task as the orchestrator holds it. Bound to one authenticated user —
 * nothing here is keyed by anything a browser could forge. */
/**
 * One instruction, several records, one at a time.
 *
 * "सारी मशीन चालू करो" is a single sentence and five separate jobs, each
 * needing its own site, customer and hour meter, and each needing its own yes
 * before anything is written. So the batch is a queue the task carries: which
 * record is being worked on now, which are still waiting, and which are
 * already done.
 *
 * It is deliberately NOT a bulk write. Every record still goes through the
 * whole path — its own questions, its own approval card read aloud, its own
 * verification — because five jobs created from one misheard sentence is
 * exactly the harm this app is built to avoid. What the batch saves the owner
 * is saying "start the next one" five times, not the checking.
 */
export type TaskBatch = {
  /** Which field of the workflow each record fills, e.g. "machine". */
  field: string;
  /** The record being worked on now. */
  current: { value: string; label: string };
  /** Still to come, in order. */
  remaining: { value: string; label: string }[];
  /** Labels of records already finished, for "3 of 7" and the final summary. */
  done: string[];
  /** Labels that could not be finished. Kept so the owner is told which ones
   * need doing by hand, rather than a count that hides them. */
  failed: string[];
};

export type AgentTask = {
  id: string;
  businessId: string;
  /** The authenticated actor this task belongs to. */
  userId: string;
  lang: AgentLang;
  state: TaskState;
  workflowId: string | null;
  /** Values gathered so far, already resolved where they name a record. */
  fields: Record<string, string | number>;
  /** What was actually asked. A read-only task has to answer THIS from what
   * ends up on screen, not merely report that it got there. */
  question: string | null;
  /** Fingerprint of exactly what was approved — see policy.confirmationFor. */
  confirmedFingerprint: string | null;
  /** Set once execution begins, so a retry can ask "did this already run?" */
  operationId: string | null;
  /** Set only while working through several records; null for a single one. */
  batch: TaskBatch | null;
  updatedAt: Date;
};
