import { requireBusinessApi } from "@/lib/api-auth";
import { listCustomerOptions } from "@/lib/services/customers";
import { listSiteOptions } from "@/lib/services/sites";
import { listExcavatorOptions } from "@/lib/services/excavators";
import { listBankAccounts, getBusinessSettings } from "@/lib/services/settings";
import { listUnbilledWorkSessions, previewNextNonGstBillNumber } from "@/lib/services/bills";
import { json, withApi } from "@/lib/with-api";

export const GET = withApi("bills.new-form", async (req) => {
  const auth = await requireBusinessApi();
  if (auth.error) return auth.error;
  const { businessId } = auth.session;

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId") ?? undefined;

  const [customers, sites, excavators] = await Promise.all([
    listCustomerOptions(businessId),
    listSiteOptions(businessId),
    listExcavatorOptions(businessId),
  ]);

  if (!customerId) {
    return json({ customers, sites, excavators });
  }

  const siteId = searchParams.get("siteId") ?? undefined;
  const excavatorId = searchParams.get("excavatorId") ?? undefined;
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;

  const [sessions, bankAccounts, business, nextNonGstNumber] = await Promise.all([
    listUnbilledWorkSessions(businessId, customerId, { siteId, excavatorId, from, to }),
    listBankAccounts(businessId),
    getBusinessSettings(businessId),
    previewNextNonGstBillNumber(businessId),
  ]);
  const customer = customers.find((c) => c.id === customerId);

  return json({
    customers,
    sites,
    excavators,
    sessions: sessions.map((s) => ({
      id: s.id,
      excavatorName: s.excavator.name,
      machineNumber: s.excavator.machineNumber,
      siteId: s.siteId,
      siteName: s.site.name,
      attachment: s.attachment,
      startDate: s.startDate,
      endDate: s.endDate ?? s.startDate,
      totalHours: s.totalHours,
      dieselLiters: s.dieselLiters ?? 0,
    })),
    bankAccounts,
    businessGstNumber: business.gstNumber,
    nextNonGstNumber,
    customerName: customer?.name ?? "",
  });
});
