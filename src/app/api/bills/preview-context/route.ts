import { requireBusinessApi } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { buildLetterhead } from "@/lib/services/bills";
import { getBusinessSettings } from "@/lib/services/settings";
import { json, withApi } from "@/lib/with-api";

/** What a bill PREVIEW needs beyond the form itself: the letterhead exactly as a
 * bill saved now would be stamped with, and the customer's printable details.
 * `?customerId=&bankAccountId=` — both optional, both tenant-scoped. Read only. */
export const GET = withApi("bills.preview-context", async (req) => {
  const auth = await requireBusinessApi();
  if (auth.error) return auth.error;
  const { businessId } = auth.session;
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId") || undefined;
  const bankAccountId = searchParams.get("bankAccountId") || undefined;

  const [business, bankAccount, customer] = await Promise.all([
    getBusinessSettings(businessId),
    bankAccountId ? db.bankAccount.findFirst({ where: { id: bankAccountId, businessId } }) : null,
    customerId
      ? db.customer.findFirst({
          where: { id: customerId, businessId },
          select: { name: true, address: true, mobile: true, gstNumber: true },
        })
      : null,
  ]);

  return json({ letterhead: buildLetterhead(business, bankAccount), customer });
});
