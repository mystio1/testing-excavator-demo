import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AGENT_LANGS, TASK_STATES, type AgentLang, type AgentTask, type TaskState } from "./types";

/**
 * Where a half-finished turn waits.
 *
 * It used to wait in a Map in one process, which was fine right up until it
 * wasn't: Render restarts on every deploy and spins down on the free tier, and
 * more than one instance can serve the same owner. The owner would tap "Yes,
 * save it" and be told "That request has expired" — on the one action in the
 * whole product that cannot happen without their explicit approval. The pending
 * task is worth seconds, but losing it costs the owner the only thing they were
 * asked to do.
 *
 * Two implementations behind one small interface: the database for the running
 * app, and memory for tests, which need neither a database nor a clock.
 */

export type TaskStore = {
  /** Scoped by user as well as id: a task id is not a capability. */
  get(id: string, scope: { businessId: string; userId: string }): Promise<AgentTask | null>;
  save(task: AgentTask): Promise<void>;
  /** Drops abandoned turns. Never throws — it is housekeeping. */
  sweep(olderThan: Date): Promise<void>;
  /**
   * The most recent turn this person completed that actually changed
   * something. What "undo" needs: the owner says "that was wrong" without
   * saying which thing, and the only honest answer is the last one.
   */
  lastWrite(scope: { businessId: string; userId: string }, since: Date): Promise<AgentTask | null>;
};

export function memoryTaskStore(): TaskStore & { clear(): void } {
  const tasks = new Map<string, AgentTask>();
  return {
    async get(id, scope) {
      const task = tasks.get(id);
      if (!task || task.userId !== scope.userId || task.businessId !== scope.businessId) return null;
      return task;
    },
    async save(task) {
      tasks.set(task.id, task);
    },
    async sweep(olderThan) {
      for (const [id, task] of tasks) {
        if (task.updatedAt < olderThan) tasks.delete(id);
      }
    },
    async lastWrite(scope, since) {
      // Reduced rather than sorted, keeping the LATER of two equal timestamps.
      // Two saves can land in the same millisecond, and "the last thing I did"
      // should be defined rather than whichever way a sort happened to fall.
      // A Map preserves insertion order, so later-saved wins the tie.
      let newest: AgentTask | null = null;
      for (const task of tasks.values()) {
        if (
          task.businessId !== scope.businessId ||
          task.userId !== scope.userId ||
          task.state !== "SUCCEEDED" ||
          !task.workflowId ||
          task.updatedAt < since
        ) {
          continue;
        }
        if (!newest || task.updatedAt >= newest.updatedAt) newest = task;
      }
      return newest;
    },
    clear() {
      tasks.clear();
    },
  };
}

/** Values read back out of a Json column are `unknown`; a task that cannot be
 * trusted is treated as absent rather than coerced into something half-formed. */
function readFields(value: unknown): Record<string, string | number> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string | number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" || typeof raw === "number") out[key] = raw;
    else return null;
  }
  return out;
}

const isState = (value: string): value is TaskState => (TASK_STATES as readonly string[]).includes(value);
const isLang = (value: string): value is AgentLang => (AGENT_LANGS as readonly string[]).includes(value);

export function dbTaskStore(): TaskStore {
  return {
    async get(id, scope) {
      const row = await db.agentTask.findFirst({
        where: { id, businessId: scope.businessId, userId: scope.userId },
      });
      if (!row) return null;

      const fields = readFields(row.fields);
      // A row written by a newer build, or hand-edited, is not something to
      // half-understand and act on. Treating it as gone costs a re-ask.
      if (!fields || !isState(row.state) || !isLang(row.lang)) {
        logger.warn("agent.task_unreadable", { taskId: id });
        return null;
      }

      return {
        id: row.id,
        businessId: row.businessId,
        userId: row.userId,
        lang: row.lang,
        state: row.state,
        workflowId: row.workflowId,
        fields,
        question: row.question,
        confirmedFingerprint: row.confirmedFingerprint,
        operationId: row.operationId,
        // Prisma hands back JsonValue; the shape is ours and written by save()
        // below, so this is a cast rather than a parse.
        batch: (row.batch as AgentTask["batch"]) ?? null,
        updatedAt: row.updatedAt,
      };
    },

    async save(task) {
      const data = {
        businessId: task.businessId,
        userId: task.userId,
        lang: task.lang,
        state: task.state,
        workflowId: task.workflowId,
        fields: task.fields,
        question: task.question,
        confirmedFingerprint: task.confirmedFingerprint,
        operationId: task.operationId,
        batch: task.batch ?? Prisma.DbNull,
        updatedAt: task.updatedAt,
      };
      await db.agentTask.upsert({ where: { id: task.id }, create: { id: task.id, ...data }, update: data });
    },

    async sweep(olderThan) {
      try {
        await db.agentTask.deleteMany({ where: { updatedAt: { lt: olderThan } } });
      } catch (err) {
        // Housekeeping must never be the thing that breaks a turn.
        logger.warn("agent.task_sweep_failed", { error: String(err) });
      }
    },

    async lastWrite(scope, since) {
      const row = await db.agentTask.findFirst({
        where: {
          businessId: scope.businessId,
          userId: scope.userId,
          state: "SUCCEEDED",
          workflowId: { not: null },
          updatedAt: { gte: since },
        },
        // createdAt breaks a same-millisecond tie, and id makes it total, so
        // "the last thing I did" is the same answer on every instance.
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      });
      if (!row) return null;
      // Reuses the same reader as get(), so a row this build cannot understand
      // is treated as absent here too rather than half-acted-on.
      return this.get(row.id, scope);
    },
  };
}
