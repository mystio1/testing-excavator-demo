import { requireBusinessApi } from "@/lib/api-auth";
import { listAssistantActions } from "@/lib/services/assistantHistory";
import { json, withApi } from "@/lib/with-api";

/**
 * What the assistant has done, for the owner.
 *
 * Deliberately NOT gated on `assistantEnabled`: if the assistant has just been
 * switched off because it did something wrong, that is exactly the moment the
 * owner most needs to see what it did. Turning a feature off must not take its
 * history with it.
 */
export const GET = withApi("agent.history.get", async (req) => {
  const auth = await requireBusinessApi();
  if (auth.error) return auth.error;

  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 30);
  const actions = await listAssistantActions(auth.session.businessId, Number.isFinite(limit) ? limit : 30);
  return json({ actions });
});
