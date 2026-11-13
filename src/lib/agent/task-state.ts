import { confirmationFor } from "./policy";
import type { AgentTask, TaskState } from "./types";

/**
 * The task lifecycle, enforced rather than described.
 *
 * The point of a table here is that SUCCEEDED is reachable only from VERIFYING.
 * However confident a model's wording is, nothing can report a job saved
 * without having gone through the step that checks the app actually saved it.
 */
const ALLOWED: Record<TaskState, readonly TaskState[]> = {
  IDLE: ["UNDERSTANDING", "CANCELLED"],
  UNDERSTANDING: ["RESOLVING_WORKFLOW", "FAILED", "CANCELLED"],
  RESOLVING_WORKFLOW: ["COLLECTING_DETAILS", "READY_FOR_CONFIRMATION", "EXECUTING", "FAILED", "CANCELLED"],
  // Answers arrive one at a time, so this state loops on itself.
  COLLECTING_DETAILS: ["COLLECTING_DETAILS", "READY_FOR_CONFIRMATION", "FAILED", "CANCELLED"],
  // A correction at the confirmation step goes back for details, not forward.
  READY_FOR_CONFIRMATION: ["COLLECTING_DETAILS", "EXECUTING", "FAILED", "CANCELLED"],
  // Once the form is SUBMITTED the user can no longer cancel it: the write may
  // already have happened, and pretending otherwise is how duplicates start.
  // That is what VERIFYING / NEEDS_RECOVERY are for.
  //
  // COLLECTING_DETAILS is allowed for one case only: the plan stopped partway
  // to ask which record was meant. A `select` or `pickFromList` can only
  // return that, and both come before the `submit` in every workflow — which
  // is not left to luck, `manifest.test.ts` asserts no workflow puts one after
  // its submit. So nothing has been written, and going back for the answer is
  // safe. Without it the owner is told "which one?" and has no way to answer.
  EXECUTING: ["VERIFYING", "COLLECTING_DETAILS", "FAILED", "NEEDS_RECOVERY"],
  VERIFYING: ["SUCCEEDED", "FAILED", "NEEDS_RECOVERY"],
  SUCCEEDED: [],
  FAILED: [],
  NEEDS_RECOVERY: ["VERIFYING", "FAILED", "CANCELLED"],
  CANCELLED: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return ALLOWED[from].includes(to);
}

/**
 * States in which another sentence belongs to the SAME task.
 *
 * The owner is still composing an instruction: the app is working out what
 * they meant, asking for a missing detail, or waiting for approval. Saying
 * more carries on where they left off.
 *
 * Everywhere else it does not. Once a plan has gone to the browser
 * (EXECUTING, VERIFYING, NEEDS_RECOVERY) or the task has finished (SUCCEEDED,
 * FAILED, CANCELLED), the next thing said is a NEW instruction — and SUCCEEDED,
 * FAILED and CANCELLED have no way out of them at all, by design.
 *
 * This is not a nicety. Without it the panel, which keeps sending the id of
 * the last task, hands a finished task to startExecuting, `transition` refuses
 * it, and the route answers 500 — measured by running the app: one spoken
 * instruction worked, and the next one came back "Sorry, that did not go
 * through" with `A task cannot go from SUCCEEDED to EXECUTING` in the log.
 * Every turn after the first was broken until the panel was reloaded.
 */
const STILL_COMPOSING: readonly TaskState[] = [
  "IDLE",
  "UNDERSTANDING",
  "RESOLVING_WORKFLOW",
  "COLLECTING_DETAILS",
  "READY_FOR_CONFIRMATION",
];

export function acceptsNewInstruction(state: TaskState): boolean {
  return STILL_COMPOSING.includes(state);
}

export class TaskTransitionError extends Error {
  constructor(from: TaskState, to: TaskState) {
    super(`A task cannot go from ${from} to ${to}`);
    this.name = "TaskTransitionError";
  }
}

export function transition(task: AgentTask, to: TaskState, now = new Date()): AgentTask {
  if (!canTransition(task.state, to)) throw new TaskTransitionError(task.state, to);
  return { ...task, state: to, updatedAt: now };
}

/**
 * Record an answer. Any change to the values invalidates an approval that was
 * given for the old ones — "make it 1500 instead" must be approved again, not
 * ride in on the yes that covered 1200.
 */
export function setFields(
  task: AgentTask,
  updates: Record<string, string | number>,
  now = new Date(),
): AgentTask {
  const fields = { ...task.fields, ...updates };
  const changed = Object.keys(updates).some((k) => task.fields[k] !== updates[k]);
  return {
    ...task,
    fields,
    confirmedFingerprint: changed ? null : task.confirmedFingerprint,
    updatedAt: now,
  };
}

/** Approve exactly the values on the task right now. */
export function confirm(task: AgentTask, now = new Date()): AgentTask {
  if (!task.workflowId) throw new Error("A task with no workflow cannot be confirmed");
  return {
    ...task,
    confirmedFingerprint: confirmationFor(task.workflowId, task.fields),
    updatedAt: now,
  };
}

/**
 * A submission whose outcome is unknown — a timeout, a dropped connection —
 * goes to NEEDS_RECOVERY, never back to EXECUTING. The next step is to look at
 * the app and find out whether it already saved, which is the only thing that
 * stops a retry becoming a second record.
 */
export function uncertain(task: AgentTask, now = new Date()): AgentTask {
  return transition(task, "NEEDS_RECOVERY", now);
}

export function newTask(input: {
  id: string;
  businessId: string;
  userId: string;
  lang: AgentTask["lang"];
  now?: Date;
}): AgentTask {
  return {
    id: input.id,
    businessId: input.businessId,
    userId: input.userId,
    lang: input.lang,
    state: "IDLE",
    workflowId: null,
    fields: {},
    question: null,
    confirmedFingerprint: null,
    operationId: null,
    batch: null,
    updatedAt: input.now ?? new Date(),
  };
}
