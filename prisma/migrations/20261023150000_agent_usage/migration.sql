-- What the assistant has cost this business this month.
--
-- Groq bills by tokens, not by request, so a request count would be a
-- comfortable number that is not the bill. One row per business per month,
-- incremented atomically, so a monthly cap can be checked before a call is
-- made and an invoice can be explained afterwards.
CREATE TABLE "AgentUsage" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "askCalls" INTEGER NOT NULL DEFAULT 0,
    "askTokens" INTEGER NOT NULL DEFAULT 0,
    "listenCalls" INTEGER NOT NULL DEFAULT 0,
    "listenSeconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentUsage_pkey" PRIMARY KEY ("id")
);

-- One row per business per month: the upsert depends on this.
CREATE UNIQUE INDEX "AgentUsage_businessId_month_key" ON "AgentUsage"("businessId", "month");
CREATE INDEX "AgentUsage_month_idx" ON "AgentUsage"("month");

ALTER TABLE "AgentUsage" ADD CONSTRAINT "AgentUsage_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
