import { logger } from "@/lib/logger";
import type { WorkflowEffect } from "./types";

/**
 * What happened, in a shape something can count.
 *
 * The logger already writes a line per request. What it cannot answer is the
 * question that decides whether this feature is working: of the turns owners
 * took yesterday, how many ended in a saved record, how many in an honest "I
 * couldn't confirm", and how many in an apology — broken down by capability,
 * because an assistant that is fine at reads and useless at starting a job
 * looks perfectly healthy in an average.
 *
 * One structured line per outcome, with a stable `msg` and flat fields, so the
 * host's log search can group them without anything else being deployed. No
 * metrics server, no new dependency, nothing to run: this product has one
 * small server and a log drain, and a counter nobody can query is worse than a
 * line somebody can grep.
 *
 * Deliberately NOT per-business. These are operational numbers about the
 * feature, and the per-business record of what the assistant did is the audit
 * trail, which is the right place for it. A business id here would turn a
 * metrics drain into a second, unmanaged copy of who did what.
 */

export type TurnOutcome =
  /** The model understood and a capability was chosen. */
  | "understood"
  /** It asked for something missing, which is a success, not a failure. */
  | "asked"
  /** Out of scope, or small talk. */
  | "replied"
  /** The owner approved a write. */
  | "approved"
  /** The app's own screen confirmed the record. */
  | "saved"
  /** It ran and the screen did not confirm. The one worth watching. */
  | "unconfirmed"
  /** Stopped to ask which record was meant. */
  | "needs_choice"
  /** The model could not be reached or could not answer. */
  | "failed";

export type TurnMetric = {
  outcome: TurnOutcome;
  /** Which capability, where one was chosen. */
  workflowId?: string | null;
  effect?: WorkflowEffect | null;
  lang?: string;
  /** Milliseconds the owner waited for this beat. */
  durationMs?: number;
  /** Error kind for a failure, so "the model is down" and "the model answered
   * badly" are not the same number. */
  reason?: string | null;
};

/**
 * Never throws and never awaits anything: an owner is waiting, and a number
 * is not worth a millisecond of their time or a single failed turn.
 */
export function recordTurnMetric(metric: TurnMetric): void {
  try {
    logger.info("agent.turn", {
      outcome: metric.outcome,
      workflowId: metric.workflowId ?? undefined,
      effect: metric.effect ?? undefined,
      lang: metric.lang,
      durationMs: metric.durationMs,
      reason: metric.reason ?? undefined,
    });
  } catch {
    /* a metric that cannot be written is not a reason to fail a turn */
  }
}

/** Speech, which has its own failure mode: it is the half that can be quietly
 * useless — a transcript that came back empty or wrong is not an error, so
 * nothing else would ever notice. */
export function recordListenMetric(metric: {
  lang: string;
  /** Empty when the clip held no usable speech, which is a real outcome. */
  heard: boolean;
  durationMs?: number;
  seconds?: number;
  /** Characters returned, so a drain can see transcripts getting shorter. */
  chars?: number;
}): void {
  try {
    logger.info("agent.listen", metric);
  } catch {
    /* as above */
  }
}

/** Wraps a beat so its duration is measured without every call site doing it.
 * The owner is holding a phone; p95 here is the number that matters. */
export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const started = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - started };
}
