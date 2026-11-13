-- What a mishearing turned out to mean.
--
-- Whisper writes "Bundapot" where the owner said "Banda Patil", and a name
-- spelled differently matches no record — so a clear instruction ends in
-- "I couldn't find that". When the owner picks the record they meant, the
-- pairing is kept: the next time that same mishearing arrives it resolves
-- straight away, and the corrected spelling also goes into the speech prompt
-- so Whisper is less likely to repeat it.
CREATE TABLE "AgentNameAlias" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "heard" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentNameAlias_pkey" PRIMARY KEY ("id")
);

-- Scoped by kind as well as business: a customer called "Patil" must never
-- start resolving an operator.
CREATE UNIQUE INDEX "AgentNameAlias_businessId_kind_heard_key" ON "AgentNameAlias"("businessId", "kind", "heard");
CREATE INDEX "AgentNameAlias_businessId_idx" ON "AgentNameAlias"("businessId");

ALTER TABLE "AgentNameAlias" ADD CONSTRAINT "AgentNameAlias_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
