import { requireBusinessApi } from "@/lib/api-auth";
import { json, parseBody, withApi } from "@/lib/with-api";
import { createExcavator, listExcavators } from "@/lib/services/excavators";
import { addExcavatorSchema } from "@/lib/validation/excavator";

export const GET = withApi("excavators.list", async () => {
  const auth = await requireBusinessApi();
  if (auth.error) return auth.error;
  const { businessId } = auth.session;

  return json({ excavators: await listExcavators(businessId) });
});

export const POST = withApi("excavators.create", async (req) => {
  const auth = await requireBusinessApi();
  if (auth.error) return auth.error;

  const input = await parseBody(req, addExcavatorSchema);
  const excavator = await createExcavator(auth.session.businessId, auth.actor, input);
  return json({ excavator });
});
