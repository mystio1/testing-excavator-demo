import { requireBusinessApi } from "@/lib/api-auth";
import { getAlerts } from "@/lib/services/dashboard";
import { db } from "@/lib/db";
import { json, withApi } from "@/lib/with-api";

/** Backs the client-rendered (app)/layout.tsx used by the Android bundled
 * build — same data the server-rendered web layout fetches directly.
 * allowFrozen: true because this is how a frozen business's own client
 * learns it's frozen at all — see (app)/layout.tsx's full-screen notice. */
export const GET = withApi("layout.get", async () => {
  const auth = await requireBusinessApi({ allowFrozen: true });
  if (auth.error) return auth.error;
  const { businessName, ownerName, businessId, businessFrozen, userId } = auth.session;

  const [alerts, user, business] = await Promise.all([
    businessFrozen ? Promise.resolve([]) : getAlerts(businessId),
    db.user.findFirst({ where: { id: userId, businessId }, select: { appPinHash: true } }),
    // The assistant's switch travels with the shell the panel is mounted in,
    // so a business it is turned off for never sees the button at all. The
    // routes refuse independently — this is about not offering something that
    // would then fail.
    db.business.findFirst({ where: { id: businessId }, select: { assistantEnabled: true } }),
  ]);

  return json({
    businessName,
    ownerName,
    alerts,
    frozen: businessFrozen,
    hasPin: !!user?.appPinHash,
    assistantEnabled: business?.assistantEnabled ?? false,
  });
});
