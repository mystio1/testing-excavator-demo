"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { swrFetcher } from "@/lib/api-client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/bill/editor/form-parts";
import { GenerateBillForm } from "./generate-bill-form";
import { sitesForCustomer, type SiteOption } from "@/components/bill/site-defaults";
import Loading from "../../loading";

type CustomerOption = { id: string; name: string; companyName: string | null };
type ExcavatorOption = { id: string; name: string; machineNumber: string | null };
type Session = {
  id: string;
  excavatorName: string;
  machineNumber: string | null;
  siteId: string;
  siteName: string;
  attachment: string | null;
  startDate: string;
  endDate: string;
  totalHours: number;
  dieselLiters: number;
};
type BankAccount = { id: string; label: string; isDefaultForGst: boolean; isDefaultForNonGst: boolean };

type BaseData = { customers: CustomerOption[]; sites: SiteOption[]; excavators: ExcavatorOption[] };
type FullData = BaseData & {
  sessions: Session[];
  bankAccounts: BankAccount[];
  businessGstNumber: string | null;
  nextNonGstNumber: string;
  customerName: string;
};

export default function NewBillPage() {
  const searchParams = useSearchParams();
  const customerId = searchParams.get("customerId") ?? "";
  const siteId = searchParams.get("siteId") ?? "";
  const excavatorId = searchParams.get("excavatorId") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  const query = new URLSearchParams();
  if (customerId) query.set("customerId", customerId);
  if (siteId) query.set("siteId", siteId);
  if (excavatorId) query.set("excavatorId", excavatorId);
  if (from) query.set("from", from);
  if (to) query.set("to", to);

  const { data } = useSWR<FullData | BaseData>(`/api/bills/new?${query.toString()}`, swrFetcher);

  // Step 1: choosing a customer pre-selects the site linked to them (still changeable).
  const [pickedCustomer, setPickedCustomer] = useState("");
  const [pickedSite, setPickedSite] = useState("");
  const allSites = data?.sites ?? [];
  const linkedSites = pickedCustomer ? sitesForCustomer(allSites, pickedCustomer) : [];
  function pickCustomer(id: string) {
    setPickedCustomer(id);
    setPickedSite(sitesForCustomer(allSites, id)[0]?.id ?? "");
  }

  if (!data) return <Loading />;
  const { customers, sites, excavators } = data;

  if (!customerId) {
    return (
      <div>
        <PageHeader title="Generate Bill" backHref="/bills" />
        <div className="px-4 pb-6 md:px-8">
          <Card>
            <CardContent>
              <form method="get" className="flex flex-col gap-4">
                <h2 className="text-base font-semibold">Select Customer</h2>
                {customers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Add a customer first.</p>
                ) : (
                  <Field label="Customer">
                    {(id) => (
                      <NativeSelect
                        id={id}
                        name="customerId"
                        required
                        value={pickedCustomer}
                        onChange={(e) => pickCustomer(e.target.value)}
                        className="h-11 min-w-0"
                      >
                        <option value="" disabled>
                          Choose a customer
                        </option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {c.companyName ? ` (${c.companyName})` : ""}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                )}
                <Field label="Site (Optional)">
                  {(id) => (
                    <NativeSelect
                      id={id}
                      name="siteId"
                      value={pickedSite}
                      onChange={(e) => setPickedSite(e.target.value)}
                      className="h-11 min-w-0"
                    >
                      <option value="">All Sites</option>
                      {linkedSites.length > 0 && (
                        <optgroup label="This customer's sites">
                          {linkedSites.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label={linkedSites.length > 0 ? "Other sites" : "Sites"}>
                        {sites
                          .filter((s) => !linkedSites.includes(s))
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </optgroup>
                    </NativeSelect>
                  )}
                </Field>
                <Field label="Machine (Optional)">
                  {(id) => (
                    <NativeSelect id={id} name="excavatorId" defaultValue="" className="h-11 min-w-0">
                      <option value="">All Machines</option>
                      {excavators.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name} ({e.machineNumber})
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <div className="@container">
                  <div className="grid grid-cols-1 gap-4 @min-[320px]:grid-cols-2">
                    <Field label="From Date (Optional)">
                      {(id) => <Input id={id} type="date" name="from" className="h-11 px-2" />}
                    </Field>
                    <Field label="To Date (Optional)">
                      {(id) => <Input id={id} type="date" name="to" className="h-11 px-2" />}
                    </Field>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave a filter blank to include everything unbilled for this customer.
                </p>
                <Button type="submit" size="lg" className="h-12 self-start text-base" disabled={customers.length === 0}>
                  Next
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const full = data as FullData;
  const hasFilters = !!(siteId || excavatorId || from || to);

  return (
    <div>
      <PageHeader title={`Generate Bill — ${full.customerName}`} backHref="/bills/new" />
      <div className="px-4 pb-6 md:px-8">
        {hasFilters && (
          <p className="mb-4 text-sm text-muted-foreground">
            Showing filtered jobs —{" "}
            <a href={`/bills/new?customerId=${customerId}`} className="font-medium text-primary underline underline-offset-2">
              clear filters
            </a>
          </p>
        )}
        <GenerateBillForm
          customerId={customerId}
          sites={sites}
          sessions={full.sessions}
          bankAccounts={full.bankAccounts}
          businessGstNumber={full.businessGstNumber}
          nextNonGstNumber={full.nextNonGstNumber}
        />
      </div>
    </div>
  );
}
