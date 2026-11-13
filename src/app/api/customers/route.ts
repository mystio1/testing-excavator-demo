import { requireBusinessApi } from "@/lib/api-auth";
import { runIdempotent } from "@/lib/idempotency";
import { parsePagination } from "@/lib/pagination";
import { createCustomer, listCustomers } from "@/lib/services/customers";
import { addCustomerSchema, customerListQuerySchema } from "@/lib/validation/customer";
import { json, parseBody, withApi } from "@/lib/with-api";

/** Customers list. Cursor-paginated (name A-Z, id as tie-breaker):
 * `?limit=50&cursor=<nextCursor>` → `{ customers, nextCursor, summary }`.
 * `summary` (totals over the whole filtered list) comes with the first page
 * only. Without `limit` (older apps) a bounded page of 200 is returned. */
export const GET = withApi("customers.list", async (req) => {
  const auth = await requireBusinessApi();
  if (auth.error) return auth.error;

  const params = new URL(req.url).searchParams;
  const { q, tripDate } = customerListQuerySchema.parse({
    q: params.get("q") ?? undefined,
    tripDate: params.get("tripDate") ?? undefined,
  });
  const page = parsePagination(req);

  return json(await listCustomers(auth.session.businessId, q, tripDate, page));
});

/**
 * Honors an `Idempotency-Key` so a retry after a lost response replays the
 * first result instead of creating a second customer.
 *
 * It is the only create the assistant drives with no natural guard of its own:
 * starting a job takes a row lock and refuses a second ACTIVE one, a day's
 * reading refuses a second entry for the same date, and leave refuses
 * overlapping dates — so a repeated instruction is already rejected there. A
 * customer has no such key (two people can genuinely share a phone number), so
 * the key has to come from the submission itself.
 */
export const POST = withApi("customers.create", async (req) => {
  const auth = await requireBusinessApi();
  if (auth.error) return auth.error;
  const { session, actor } = auth;

  const input = await parseBody(req, addCustomerSchema);
  return runIdempotent(
    { req, businessId: session.businessId, actorId: actor.id, operation: "customer.create", payload: input },
    async (tx) => {
      const customer = await createCustomer(session.businessId, actor, input, { tx });
      return {
        ok: true,
        status: 200,
        body: { customer },
        resourceType: "Customer",
        resourceId: customer.id,
      };
    },
  );
});
