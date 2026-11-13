-- Per-business model override for the assistant.
--
-- Null means the deployment's own choice (GROQ_MODEL). It exists so one
-- business can be moved to a different model without moving everyone: to try
-- a better one on a willing customer, or to move one off a model that is
-- answering them badly. Neither should need a deploy.
ALTER TABLE "Business" ADD COLUMN "assistantModel" TEXT;
