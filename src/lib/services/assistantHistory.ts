import { db } from "@/lib/db";

/**
 * What the assistant has done, for the owner to read.
 *
 * The rows already existed — `trail.ts` writes one per approval and one per
 * outcome — but nothing surfaced them, which meant the owner had no way to
 * check up on something acting on their behalf. For a person who cannot read
 * the screen well enough to catch a mistake as it happens, being able to look
 * afterwards is the whole safety net.
 *
 * Read-only, and never the audit trail's replacement: this reads the trail.
 * Scoped by businessId like every other service function, taken from the
 * verified session by the caller.
 */

/** One thing the assistant was asked to do, with how it ended. */
export type AssistantAction = {
  taskId: string;
  /** "work.start", so the UI can name it in the owner's language. */
  workflowId: string | null;
  /** What the owner approved, as they were shown it. */
  fields: Record<string, unknown> | null;
  when: Date;
  /** Approved but nothing reported back yet, confirmed, or left in doubt. */
  outcome: "pending" | "saved" | "unconfirmed";
  /** What the screen said, when it did not confirm. */
  detail: string | null;
};

const ACTIONS = ["assistant.approved", "assistant.executed", "assistant.unverified"] as const;

/**
 * Folded by task: an approval and its outcome are two rows about one thing,
 * and the owner wants to see one line per thing they asked for.
 *
 * `take` is a row budget rather than an action count, since each action is up
 * to two rows; the result is trimmed to `limit` afterwards.
 */
export async function listAssistantActions(
  businessId: string,
  limit = 30,
): Promise<AssistantAction[]> {
  const bounded = Math.min(Math.max(1, limit), 100);
  const rows = await db.auditLog.findMany({
    where: { businessId, entityType: "AgentTask", action: { in: [...ACTIONS] } },
    orderBy: { createdAt: "desc" },
    take: bounded * 3,
    select: { action: true, entityId: true, createdAt: true, after: true, details: true },
  });

  const byTask = new Map<string, AssistantAction>();
  for (const row of rows) {
    const details = (row.details ?? {}) as { workflowId?: string; screenSaid?: string };
    // Rows arrive newest first, so the first one seen for a task is its latest
    // state — which is the one the owner should be shown.
    const existing = byTask.get(row.entityId);
    if (!existing) {
      byTask.set(row.entityId, {
        taskId: row.entityId,
        workflowId: details.workflowId ?? null,
        fields: (row.after as Record<string, unknown> | null) ?? null,
        when: row.createdAt,
        outcome:
          row.action === "assistant.executed"
            ? "saved"
            : row.action === "assistant.unverified"
              ? "unconfirmed"
              : "pending",
        detail: details.screenSaid ?? null,
      });
      continue;
    }
    // The approval row is the one carrying the values the owner saw, and it is
    // older than the outcome row, so it fills in what the outcome row lacks.
    if (row.action === "assistant.approved") {
      existing.fields ??= (row.after as Record<string, unknown> | null) ?? null;
      existing.workflowId ??= details.workflowId ?? null;
    }
  }

  return [...byTask.values()].slice(0, bounded);
}
