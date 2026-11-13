-- A batch: one instruction applied to several records, one at a time.
--
-- "sari machine start karo" is one sentence and several jobs. The agent works
-- through them in turn, asking each machine's own questions, so the task has to
-- remember which record it is on and which are still waiting — across requests,
-- because the panel reloads and sends only a task id.
--
-- Nullable: every task that is not a batch leaves it null, which is almost all
-- of them.
ALTER TABLE "AgentTask" ADD COLUMN "batch" JSONB;
