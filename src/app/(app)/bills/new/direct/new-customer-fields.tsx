"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { apiFetch, newIdempotencyKey } from "@/lib/api-client";
import { useApiForm } from "@/lib/use-api-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/bill/editor/form-parts";

/** Adds a customer without leaving the Direct Bill flow, then carries straight
 * on to the bill for them. Same POST /api/customers as the Customers page. */
export function NewCustomerFields({ onCancel }: { onCancel?: () => void }) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  // One key per form: a retry replays the first result instead of adding the customer twice.
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const { error, pending, run } = useApiForm(async (body: Record<string, unknown>) => {
    const { customer } = await apiFetch<{ customer: { id: string } }>("/api/customers", {
      method: "POST",
      body: JSON.stringify(body),
      idempotencyKey,
    });
    await mutate(
      (key) => typeof key === "string" && (key.startsWith("/api/customers") || key.startsWith("/api/bills/new")),
    );
    router.push(`/bills/new/direct?customerId=${encodeURIComponent(customer.id)}`);
  });

  // Not a nested <form>: this sits inside the page's customer-picker form.
  async function save() {
    await run({
      name,
      mobile,
      companyName: companyName || undefined,
      gstNumber: gstNumber || undefined,
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-dashed p-4">
      <h3 className="text-sm font-semibold">New Customer</h3>
      <Field label="Customer Name">
        {(id) => (
          <Input id={id} value={name} onChange={(e) => setName(e.target.value)} className="h-11" autoFocus />
        )}
      </Field>
      <Field label="Mobile Number">
        {(id) => (
          <Input id={id} type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} className="h-11" />
        )}
      </Field>
      <Field label="Company Name (Optional)">
        {(id) => <Input id={id} value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="h-11" />}
      </Field>
      <Field label="GST Number (Optional)">
        {(id) => <Input id={id} value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} className="h-11" />}
      </Field>
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="lg"
          className="h-12 text-base"
          disabled={pending || !name.trim() || !mobile.trim()}
          onClick={save}
        >
          {pending ? "Saving..." : "Save & Continue"}
        </Button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-sm font-semibold text-muted-foreground">
            Pick an existing customer instead
          </button>
        )}
      </div>
    </div>
  );
}
