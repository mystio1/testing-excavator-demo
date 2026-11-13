import { createHash } from "node:crypto";
import { missingFields, resolve } from "./resolver";
import type { AgentTask, Workflow } from "./types";

/**
 * The deterministic gate between "the model proposed something" and "the
 * browser does it". None of this asks the model to behave: a proposal that is
 * not registered, not permitted, not complete or not approved is refused here,
 * in code the model has no influence over.
 */

export type PolicyDecision =
  | { allow: true; workflow: Workflow; needsConfirmation: boolean }
  | { allow: false; reason: PolicyRefusal; message: string };

export type PolicyRefusal =
  | "UNKNOWN_WORKFLOW"
  | "NOT_PERMITTED"
  | "MISSING_FIELDS"
  | "NOT_CONFIRMED"
  | "CONFIRMATION_STALE";

/** Who is driving. Operators reach the app through their own portal and must
 * not gain an owner's reach by asking an assistant for it. */
export type Actor = { kind: "owner" | "operator"; businessId: string; userId: string };

/**
 * Exactly what was approved: the workflow and the values, not merely "the user
 * said yes once". Change the amount after approval and the fingerprint moves,
 * so the old approval no longer matches and the agent has to ask again.
 */
export function confirmationFor(workflowId: string, fields: Record<string, string | number>): string {
  const canonical = JSON.stringify(
    Object.keys(fields)
      .sort()
      .map((k) => [k, String(fields[k])]),
  );
  return createHash("sha256").update(`${workflowId}\u0000${canonical}`).digest("hex");
}

/** A read is only ever a read; everything that writes is confirmed before it
 * runs, and sensitive writes stay confirmed however small the amount. */
export function requiresConfirmation(workflow: Workflow): boolean {
  return workflow.effect !== "READ";
}

/** Operators get the read-only workflows their own portal already shows them.
 * Anything that writes stays with the owner. */
function permitted(actor: Actor, workflow: Workflow): boolean {
  if (actor.kind === "owner") return true;
  return workflow.effect === "READ";
}

/**
 * The single call every proposed action passes through. Order matters: an
 * unknown workflow is refused before permissions are considered, and an
 * incomplete one before confirmation, so the agent asks the useful question
 * rather than the alarming one.
 */
export function authorize(task: AgentTask, actor: Actor, workflowId: string): PolicyDecision {
  const workflow = resolve(workflowId);
  if (!workflow) {
    return {
      allow: false,
      reason: "UNKNOWN_WORKFLOW",
      message: "I can't do that in this app.",
    };
  }

  if (!permitted(actor, workflow)) {
    return {
      allow: false,
      reason: "NOT_PERMITTED",
      message: "You don't have permission for that.",
    };
  }

  const missing = missingFields(workflow, task.fields);
  if (missing.length > 0) {
    return {
      allow: false,
      reason: "MISSING_FIELDS",
      message: `Still needed: ${missing.map((f) => f.name).join(", ")}.`,
    };
  }

  if (requiresConfirmation(workflow)) {
    const expected = confirmationFor(workflowId, task.fields);
    if (!task.confirmedFingerprint) {
      return { allow: false, reason: "NOT_CONFIRMED", message: "Please confirm before I save this." };
    }
    if (task.confirmedFingerprint !== expected) {
      // Something moved after approval — re-approve the new figures, never the
      // old approval against new values.
      return {
        allow: false,
        reason: "CONFIRMATION_STALE",
        message: "Something changed since you confirmed. Please check and confirm again.",
      };
    }
  }

  return { allow: true, workflow, needsConfirmation: requiresConfirmation(workflow) };
}

/**
 * Tasks are bound to the authenticated actor. A task id is not a capability:
 * holding one is useless without being the user and business it was opened for.
 */
export function ownsTask(task: AgentTask, actor: Actor): boolean {
  return task.userId === actor.userId && task.businessId === actor.businessId;
}
