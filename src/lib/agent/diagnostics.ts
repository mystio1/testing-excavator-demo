import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { AgentLang, AgentResponse } from "./types";

/**
 * What the owner said, and what the model made of it — kept briefly, and only
 * when someone has deliberately turned it on.
 *
 * The audit trail answers "what changed": these values were approved at 14:02
 * and the screen confirmed them. It cannot answer the question support
 * actually gets, which is "why did it understand me that way". For that you
 * need the sentence and the model's reply to it.
 *
 * Those are also the sensitive parts — the owner's words carry their
 * customers' names and phone numbers — so this is off for every business until
 * support opens a window on it, and the window closes itself. The alternative,
 * logging every turn forever just in case, keeps other people's personal data
 * against a day that may never come.
 */

/** Long enough to investigate a complaint from last week, short enough that
 * nothing accumulates. */
const RETENTION_DAYS = Number(process.env.AGENT_DIAGNOSTICS_RETENTION_DAYS ?? 7);

export type TurnRecord = {
  businessId: string;
  userId: string;
  taskId: string | null;
  lang: AgentLang;
  utterance: string;
  /** Null when the model could not be reached at all. */
  reply: AgentResponse | null;
  /** The error kind when there was no reply. */
  errorKind?: string;
};

/** Is a window open on this business right now? */
export async function diagnosticsOpen(businessId: string, now = new Date()): Promise<boolean> {
  const business = await db.business.findFirst({
    where: { id: businessId },
    select: { diagnosticsUntil: true },
  });
  return !!business?.diagnosticsUntil && business.diagnosticsUntil > now;
}

/**
 * Record one turn, if a window is open.
 *
 * Never throws and never delays the answer: this is a diagnostic aid, and the
 * owner is waiting. Failures are logged, because a diagnostic that quietly
 * stops working is worse than none — someone would go looking for rows that
 * were never written.
 */
export async function recordTurn(turn: TurnRecord): Promise<void> {
  try {
    if (!(await diagnosticsOpen(turn.businessId))) return;

    await db.agentTurnLog.create({
      data: {
        businessId: turn.businessId,
        userId: turn.userId,
        taskId: turn.taskId,
        lang: turn.lang,
        utterance: turn.utterance,
        modelReply: turn.reply ?? undefined,
        workflowId: turn.reply?.kind === "action" ? turn.reply.workflowId : null,
        outcome: turn.reply ? turn.reply.kind : `error:${turn.errorKind ?? "unknown"}`,
      },
    });
  } catch (err) {
    logger.error("agent.diagnostics_not_recorded", err, { businessId: turn.businessId });
  }
}

/**
 * Drop anything past the retention window, and anything belonging to a
 * business whose window has since closed.
 *
 * The second half matters: closing the window has to mean the recording stops
 * AND what was recorded goes, or "off" only ever meant "off from now on".
 */
export async function sweepDiagnostics(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    const expired = await db.agentTurnLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    const closed = await db.agentTurnLog.deleteMany({
      where: {
        OR: [{ business: { diagnosticsUntil: null } }, { business: { diagnosticsUntil: { lt: now } } }],
      },
    });
    return expired.count + closed.count;
  } catch (err) {
    logger.warn("agent.diagnostics_sweep_failed", { error: String(err) });
    return 0;
  }
}

/** What support reads. Newest first, bounded — nobody needs a thousand turns
 * to understand one complaint. */
export async function recentTurns(businessId: string, limit = 50) {
  return db.agentTurnLog.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(1, limit), 200),
  });
}
