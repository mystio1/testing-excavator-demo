"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { swrFetcher } from "@/lib/api-client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/bill/editor/form-parts";
import { GenerateDirectBillForm } from "./generate-direct-bill-form";
import { NewCustomerFields } from "./new-customer-fields";
import type { SiteOption } from "@/components/bill/site-defaults";
import Loading from "../../../loading";

type CustomerOption = { id: string; name: string; companyName: string | null };
type ExcavatorOption = { id: string; name: string; machineNumber: string | null };
type BankAccount = { id: string; label: string; isDefaultForGst: boolean; isDefaultForNonGst: boolean };

type BaseData = { customers: CustomerOption[] };
type FullData = BaseData & {
  excavators: ExcavatorOption[];
  sites: SiteOption[];
  bankAccounts: BankAccount[];
  businessGstNumber: string | null;
  nextNonGstNumber: string;
  customerName: string;
};

export default function NewDirectBillPage() {
  const searchParams = useSearchParams();
  const customerId = searchParams.get("customerId") ?? "";

  const { data } = useSWR<FullData | BaseData>(
    `/api/bills/new/direct${customerId ? `?customerId=${customerId}` : ""}`,
    swrFetcher,
  );

  if (!data) return <Loading />;

  if (!customerId) {
    const { customers } = data;
    return (
      <div>
        <PageHeader title="Direct Bill" backHref="/bills" />
        <div className="px-4 pb-6 md:px-8">
          <Card>
            <CardContent>
              <CustomerPicker customers={customers} />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const full = data as FullData;

  return (
    <div>
      <PageHeader title={`Direct Bill — ${full.customerName}`} backHref="/bills/new/direct" />
      <div className="px-4 pb-6 md:px-8">
        <GenerateDirectBillForm
          customerId={customerId}
          excavators={full.excavators}
          sites={full.sites ?? []}
          bankAccounts={full.bankAccounts}
          businessGstNumber={full.businessGstNumber}
          nextNonGstNumber={full.nextNonGstNumber}
        />
      </div>
    </div>
  );
}

const ADD_NEW = "__add_new_customer__";

function CustomerPicker({ customers }: { customers: CustomerOption[] }) {
  // With no customers yet there is nothing to pick: go straight to adding one.
  const [adding, setAdding] = useState(customers.length === 0);

  if (adding) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Select Customer</h2>
        <NewCustomerFields onCancel={customers.length > 0 ? () => setAdding(false) : undefined} />
      </div>
    );
  }

  return (
    <form method="get" className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Select Customer</h2>
      <Field label="Customer">
        {(id) => (
          <NativeSelect
            id={id}
            name="customerId"
            required
            defaultValue=""
            className="h-11 min-w-0"
            onChange={(e) => {
              if (e.target.value === ADD_NEW) setAdding(true);
            }}
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
            <option value={ADD_NEW}>+ Add new customer</option>
          </NativeSelect>
        )}
      </Field>
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="self-start text-sm font-semibold text-primary-text"
      >
        + Add New Customer
      </button>
      <Button type="submit" size="lg" className="h-12 self-start text-base">
        Next
      </Button>
    </form>
  );
}
