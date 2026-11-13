-- Per-business switch for the assistant.
--
-- On by default, so nothing changes for anyone. It exists so that when the
-- assistant misbehaves for ONE business, it can be turned off for them in
-- seconds instead of requiring a deploy that takes it away from everybody —
-- and so that the owner keeps the rest of the app while it is off.
ALTER TABLE "Business" ADD COLUMN "assistantEnabled" BOOLEAN NOT NULL DEFAULT true;
