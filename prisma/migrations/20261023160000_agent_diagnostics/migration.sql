-- Diagnostics for the assistant: what the owner said and what the model made
-- of it, kept briefly so support can answer "why did it understand me that
-- way" — a question the audit trail cannot answer, because the trail records
-- what was approved, not what was heard.
--
-- Off for every business by default, and ON only until a moment that passes.
-- A timestamp rather than a boolean on purpose: what gets recorded is the
-- owner's own words, which can carry their customers' names and numbers, and a
-- flag can be left on by accident forever while a window closes itself.
ALTER TABLE "Business" ADD COLUMN "diagnosticsUntil" TIMESTAMP(3);

CREATE TABLE "AgentTurnLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "lang" TEXT NOT NULL,
    "utterance" TEXT NOT NULL,
    "modelReply" JSONB,
    "workflowId" TEXT,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTurnLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentTurnLog_businessId_createdAt_idx" ON "AgentTurnLog"("businessId", "createdAt");
-- Supports the retention sweep.
CREATE INDEX "AgentTurnLog_createdAt_idx" ON "AgentTurnLog"("createdAt");

ALTER TABLE "AgentTurnLog" ADD CONSTRAINT "AgentTurnLog_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
