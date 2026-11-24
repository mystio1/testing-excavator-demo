import { requireBusinessApi } from "@/lib/api-auth";
import { json, withApi } from "@/lib/with-api";
import { getMachineEarnings } from "@/lib/services/siteAnalysis";
import { machineEarningsQuerySchema } from "@/lib/validation/excavator";

/** Machine Performance: per-machine revenue and hours by day / week / month / year, valued by the
 * Site Analysis engine, plus the sites whose missing rates leave work unpriced. */
export const GET = withApi("excavators.performance", async (req) => {
  const auth = await requireBusinessApi();
  if (auth.error) return auth.error;
  const { period, today } = machineEarningsQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return json(await getMachineEarnings(auth.session.businessId, period, today ?? new Date().toISOString().slice(0, 10)));
});
