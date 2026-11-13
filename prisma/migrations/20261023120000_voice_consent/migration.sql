-- Voice consent for the assistant.
--
-- Speaking to the assistant sends a few seconds of audio to a speech service
-- outside India. That audio carries customer names and phone numbers, so the
-- owner is told plainly and asked once before the microphone is used at all.
--
-- Additive and nullable: existing owners are simply treated as not yet asked,
-- and the assistant keeps working by typing for anyone who declines. Nothing
-- is backfilled, because a consent nobody gave must never be assumed.
ALTER TABLE "User" ADD COLUMN "voiceConsentAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "voiceConsentText" TEXT;
