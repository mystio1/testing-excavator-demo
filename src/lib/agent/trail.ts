import { recordAudit, type AuditActor } from "@/lib/audit";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { WorkflowEffect } from "./types";

/**
 * The assistant's own line in the audit trail.
 *
 * The assistant does not write to the database. It drives the real forms, so
 * the row that lands is written by the same route a tap would have used, with
 * the same OWNER actor — which means that without this, a month later nobody
 * can tell a job the owner typed in from one the assistant filled on their
 * say-so. That matters most when a figure is wrong and the question is where
 * it came from.
 *
 * So two entries are written per task: what the owner approved, and what the
 * screen then showed. Joined by taskId, they answer "the assistant proposed
 * this, the owner said yes at 14:02, and the app confirmed it at 14:02:06".
 *
 * This is a SECOND layer, not a replacement. The record-level entry the form
 * writes stays authoritative for what changed; this one records who asked for
 * it and how. It is therefore best-effort by construction — the change happens
 * in the browser later, so it cannot share a transaction with it — and a
 * failure here is logged rather than allowed to block the owner's work.
 */

export type AgentTrailPhase =
  /** The owner was shown the values and said yes. Consent, before anything ran. */
  | "approved"
  /** The app's own screen confirmed the record afterwards. */
  | "executed"
  /** It ran, and the screen did not confirm it. Neither done nor safely undone. */
  | "unverified";

export type AgentTrailEntry = {
  taskId: string;
  workflowId: string;
  effect: WorkflowEffect;
  /** As they were put in front of the owner. Redacted by recordAudit. */
  fields: Record<string, string | number>;
  phase: AgentTrailPhase;
  /** What the screen said when it did not confirm. */
  detail?: string;
};

export type RecordFn = (entry: AgentTrailEntry) => Promise<void>;

/**
 * Reads are not recorded. The trail is for money-bearing and operationally
 * important changes, and an entry for every "how many customers do I have"
 * would bury the entries that matter.
 */
export function shouldRecord(effect: WorkflowEffect): boolean {
  return effect !== "READ";
}

/** A recorder bound to one verified session. The business and the actor come
 * from that session and never from a request body. */
export function agentTrail(businessId: string, actor: AuditActor): RecordFn {
  return async (entry) => {
    if (!shouldRecord(entry.effect)) return;
    try {
      await recordAudit(db, {
        businessId,
        actor,
        action: `assistant.${entry.phase}`,
        // The task, not the record: the assistant does not know the id of the
        // row its form submission created. The record's own entry carries that,
        // and the two line up by time and by this business.
        entityType: "AgentTask",
        entityId: entry.taskId,
        after: entry.phase === "approved" ? entry.fields : undefined,
        details: {
          via: "assistant",
          workflowId: entry.workflowId,
          effect: entry.effect,
          ...(entry.detail ? { screenSaid: entry.detail } : {}),
        },
      });
    } catch (err) {
      // The owner's work is not held up because the trail could not be
      // written, but this must never fail silently.
      logger.error("agent.trail_failed", err, {
        taskId: entry.taskId,
        workflowId: entry.workflowId,
        phase: entry.phase,
      });
    }
  };
}
