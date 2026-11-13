-- A half-finished assistant turn, waiting on the owner.
--
-- These lived in a Map in one process, which was fine until it wasn't: Render
-- restarts on every deploy and spins down on the free tier, and more than one
-- instance can serve the same owner. The owner would tap "Yes, save it" and be
-- told "That request has expired" — on the one action in the product that
-- needs their explicit approval to happen at all.
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "state" TEXT NOT NULL,
    "workflowId" TEXT,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "question" TEXT,
    "confirmedFingerprint" TEXT,
    "operationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- A task id is not a capability: every read is scoped by business AND user.
CREATE INDEX "AgentTask_businessId_userId_idx" ON "AgentTask"("businessId", "userId");
-- Supports the sweep of abandoned turns.
CREATE INDEX "AgentTask_updatedAt_idx" ON "AgentTask"("updatedAt");

ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
