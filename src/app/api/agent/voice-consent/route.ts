import { requireBusinessApi } from "@/lib/api-auth";
import { assertAssistantAvailable } from "@/lib/agent/availability";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enforceRateLimits } from "@/lib/rateLimit";
import { AGENT_LANGS, type AgentLang } from "@/lib/agent/types";
import { noticeFingerprint } from "@/lib/agent/consent";
import { json, parseBody, withApi } from "@/lib/with-api";
import { voiceConsentSchema } from "@/lib/validation/agent";

/**
 * Records that the owner was shown the voice notice and agreed to it.
 *
 * GET says whether they already have, so the notice is shown once rather than
 * every time — and so the server, not the browser, is the thing that decides.
 * A localStorage flag would be lost with the device and would prove nothing if
 * anyone ever asked.
 *
 * Only the signed-in owner's own row is ever touched: the user comes from the
 * session, never from the body.
 */

export const GET = withApi("agent.voiceConsent.get", async () => {
  const auth = await requireBusinessApi();
  if (auth.error) return auth.error;

  const user = await db.user.findFirst({
    where: { id: auth.session.userId, businessId: auth.session.businessId },
    select: { voiceConsentAt: true, voiceConsentText: true },
  });
  return json({
    given: !!user?.voiceConsentAt,
    noticeAgreed: user?.voiceConsentText ?? null,
  });
});

export const POST = withApi("agent.voiceConsent.set", async (req) => {
  const auth = await requireBusinessApi();
  if (auth.error) return auth.error;
  const { session, actor } = auth;

  await enforceRateLimits(
    [{ key: `agent-consent:user:${session.userId}`, limit: 20, windowMs: 60 * 60 * 1000 }],
    "Too many attempts. Please wait a while and try again.",
  );

  const input = await parseBody(req, voiceConsentSchema);

  // Granting is gated on the assistant being switched on; WITHDRAWING never
  // is. Taking consent back must not depend on a feature flag — a permission
  // you cannot revoke while someone else holds a switch is not one you really
  // gave.
  if (input.granted) await assertAssistantAvailable(session.businessId);
  const lang: AgentLang = AGENT_LANGS.includes(input.lang as AgentLang) ? (input.lang as AgentLang) : "en";

  // Withdrawing is as easy as giving: `granted: false` clears it, and the
  // assistant goes back to typing only. A consent you cannot take back is not
  // one you really gave.
  const voiceConsentAt = input.granted ? new Date() : null;
  const voiceConsentText = input.granted ? noticeFingerprint(lang) : null;

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: session.userId },
      data: { voiceConsentAt, voiceConsentText },
    });
    // On the record, both ways: being able to show WHEN consent was given is
    // the entire point of storing it, and a withdrawal matters just as much.
    await recordAudit(tx, {
      businessId: session.businessId,
      actor,
      action: input.granted ? "assistant.voice_consent.given" : "assistant.voice_consent.withdrawn",
      entityType: "User",
      entityId: session.userId,
      details: { notice: voiceConsentText ?? noticeFingerprint(lang) },
    });
  });

  return json({ given: input.granted });
});
