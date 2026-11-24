"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Receipt } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useApiForm } from "@/lib/use-api-form";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/native-select";
import { formatCurrency } from "@/lib/utils/currency";
import { cn } from "@/lib/utils";
import { fromPaise, gstTaxPaise, lineAmountPaise, toPaise } from "@/components/bill/money-preview";
import { useIdempotencyKey } from "@/components/bill/use-idempotency-key";
import { TAX_RATES } from "@/components/bill/editor/bill-math";
import { CheckboxField, ChoiceChip, Field } from "@/components/bill/editor/form-parts";
import { SubmitBar } from "@/components/bill/editor/submit-bar";
import { BillPreviewDialog } from "@/components/bill/bill-preview-dialog";
import { sitesForCustomer, type SiteOption } from "@/components/bill/site-defaults";

import { todayLocal } from "@/lib/utils/dates";
type Excavator = {
  id: string;
  name: string;
  machineNumber: string | null;
};

type BankAccount = {
  id: string;
  label: string;
  isDefaultForGst: boolean;
  isDefaultForNonGst: boolean;
};

export function GenerateDirectBillForm({
  customerId,
  excavators,
  sites = [],
  bankAccounts,
  businessGstNumber,
  nextNonGstNumber,
}: {
  customerId: string;
  excavators: Excavator[];
  /** The customer's sites; the first (ongoing) one's saved rates pre-fill Bucket / Breaker. */
  sites?: SiteOption[];
  bankAccounts: BankAccount[];
  businessGstNumber: string | null;
  nextNonGstNumber: string;
}) {
  const router = useRouter();
  const rateLabelId = useId();
  // One key per submission: a retry after a timeout re-sends it, so the server
  // returns the original bill instead of creating a duplicate.
  const idem = useIdempotencyKey();
  const { error, pending, run } = useApiForm(async (body: Record<string, unknown>) => {
    const { bill } = await idem.submit((idempotencyKey) =>
      apiFetch<{ bill: { id: string } }>("/api/bills/direct", {
        method: "POST",
        body: JSON.stringify(body),
        idempotencyKey,
      }),
    );
    router.push(`/bills/detail?id=${bill.id}`);
  });

  const [bucketHours, setBucketHours] = useState(0);
  const site = sitesForCustomer(sites, customerId)[0];
  const [bucketRate, setBucketRate] = useState(Number(site?.bucketRate) || 0);
  const [breakerHours, setBreakerHours] = useState(0);
  const [breakerRate, setBreakerRate] = useState(Number(site?.breakerRate) || 0);
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<null | Record<string, string>>(null);
  const [transportCharges, setTransportCharges] = useState(0);
  const [dieselLiters, setDieselLiters] = useState(0);
  const [dieselPricePerLiter, setDieselPricePerLiter] = useState(0);
  const [billType, setBillType] = useState<"GST" | "NON_GST">("NON_GST");
  const [gstPercentage, setGstPercentage] = useState(18);
  const [manualNonGstNumber, setManualNonGstNumber] = useState(false);
  const [showCustomerPhone, setShowCustomerPhone] = useState(true);

  const defaultBankId =
    bankAccounts.find((b) => (billType === "GST" ? b.isDefaultForGst : b.isDefaultForNonGst))?.id ?? "";

  // Preview of what the server will store, in exact integer paise (see money-preview.ts).
  const totals = useMemo(() => {
    const bucketAmount = lineAmountPaise(bucketHours, bucketRate);
    const breakerAmount = lineAmountPaise(breakerHours, breakerRate);
    const subtotal = bucketAmount + breakerAmount;
    const taxable = subtotal + toPaise(transportCharges);
    const tax = billType === "GST" ? gstTaxPaise(taxable, gstPercentage) : 0;
    const dieselAdvance = lineAmountPaise(dieselLiters, dieselPricePerLiter);
    const total = taxable + tax - dieselAdvance;
    return {
      bucketAmount: fromPaise(bucketAmount),
      breakerAmount: fromPaise(breakerAmount),
      subtotal: fromPaise(subtotal),
      taxable: fromPaise(taxable),
      tax: fromPaise(tax),
      dieselAdvance: fromPaise(dieselAdvance),
      total: fromPaise(total),
    };
  }, [bucketHours, bucketRate, breakerHours, breakerRate, transportCharges, billType, gstPercentage, dieselLiters, dieselPricePerLiter]);

  const today = todayLocal();
  const nothingBillable = totals.taxable <= 0;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await run({
      customerId,
      excavatorId: fd.get("excavatorId"),
      billDate: fd.get("billDate"),
      fromDate: fd.get("fromDate"),
      toDate: fd.get("toDate"),
      bucketHours: bucketHours || 0,
      bucketRate: bucketRate || 0,
      breakerHours: breakerHours || 0,
      breakerRate: breakerRate || 0,
      transportCharges: transportCharges || 0,
      dieselLiters: dieselLiters || 0,
      dieselPricePerLiter: dieselPricePerLiter || 0,
      billType,
      billNumber: fd.get("billNumber") || undefined,
      gstPercentage: billType === "GST" ? gstPercentage : undefined,
      buyerGstin: fd.get("buyerGstin") || undefined,
      bankAccountId: fd.get("bankAccountId") || undefined,
      notes: fd.get("notes") || undefined,
      showCustomerPhone,
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4">
      <Card>
        <CardContent className="@container flex flex-col gap-4">
          <h2 className="text-base font-semibold">Machine &amp; Period</h2>
          {excavators.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add a machine first.</p>
          ) : (
            <Field label="Machine">
              {(id) => (
                <NativeSelect id={id} name="excavatorId" required defaultValue="" className="h-11 min-w-0">
                  <option value="" disabled>
                    Choose a machine
                  </option>
                  {excavators.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.machineNumber ? ` (${e.machineNumber})` : ""}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          )}
          <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-3">
            <Field label="Bill Date">
              {(id) => <Input id={id} name="billDate" type="date" defaultValue={today} required className="h-11 px-2" />}
            </Field>
            <Field label="From Date">
              {(id) => <Input id={id} name="fromDate" type="date" defaultValue={today} required className="h-11 px-2" />}
            </Field>
            <Field label="To Date">
              {(id) => <Input id={id} name="toDate" type="date" defaultValue={today} required className="h-11 px-2" />}
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <h2 className="text-base font-semibold">Bucket &amp; Breaker Hours</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Bucket Hours">
              {(id) => (
                <Input
                  id={id}
                  name="bucketHours"
                  type="number"
                  min="0"
                  step="0.1"
                  inputMode="decimal"
                  value={bucketHours || ""}
                  onChange={(e) => setBucketHours(Number(e.target.value) || 0)}
                  className="h-11"
                />
              )}
            </Field>
            <Field label="Bucket Rate / Hour">
              {(id) => (
                <Input
                  id={id}
                  name="bucketRate"
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={bucketRate || ""}
                  onChange={(e) => setBucketRate(Number(e.target.value) || 0)}
                  className="h-11"
                />
              )}
            </Field>
            <Field label="Breaker Hours">
              {(id) => (
                <Input
                  id={id}
                  name="breakerHours"
                  type="number"
                  min="0"
                  step="0.1"
                  inputMode="decimal"
                  value={breakerHours || ""}
                  onChange={(e) => setBreakerHours(Number(e.target.value) || 0)}
                  className="h-11"
                />
              )}
            </Field>
            <Field label="Breaker Rate / Hour">
              {(id) => (
                <Input
                  id={id}
                  name="breakerRate"
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={breakerRate || ""}
                  onChange={(e) => setBreakerRate(Number(e.target.value) || 0)}
                  className="h-11"
                />
              )}
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <h2 className="text-base font-semibold">Transport &amp; Diesel</h2>
          <Field label="Transport Charges (if applicable)">
            {(id) => (
              <Input
                id={id}
                name="transportCharges"
                type="number"
                min="0"
                inputMode="decimal"
                placeholder="Leave blank if not applicable"
                value={transportCharges || ""}
                onChange={(e) => setTransportCharges(Number(e.target.value) || 0)}
                className="h-11"
              />
            )}
          </Field>
          <p className="text-sm text-muted-foreground">
            Diesel supplied by the customer is deducted from the total as an advance.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Diesel Litres">
              {(id) => (
                <Input
                  id={id}
                  name="dieselLiters"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={dieselLiters || ""}
                  onChange={(e) => setDieselLiters(Number(e.target.value) || 0)}
                  className="h-11"
                />
              )}
            </Field>
            <Field label="Diesel Price / Litre">
              {(id) => (
                <Input
                  id={id}
                  name="dieselPricePerLiter"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={dieselPricePerLiter || ""}
                  onChange={(e) => setDieselPricePerLiter(Number(e.target.value) || 0)}
                  className="h-11"
                />
              )}
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <h2 className="text-base font-semibold">Bill Type</h2>
          <div role="group" aria-label="Bill type" className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
            <button
              type="button"
              aria-pressed={billType === "NON_GST"}
              onClick={() => setBillType("NON_GST")}
              className={cn(
                "flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 py-2.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                billType === "NON_GST" ? "bg-card shadow-sm" : "text-foreground/70",
              )}
            >
              <Receipt aria-hidden className="size-4 shrink-0" /> Non-GST
            </button>
            <button
              type="button"
              aria-pressed={billType === "GST"}
              onClick={() => setBillType("GST")}
              className={cn(
                "flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 py-2.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                billType === "GST" ? "bg-card shadow-sm" : "text-foreground/70",
              )}
            >
              <FileText aria-hidden className="size-4 shrink-0" /> GST Bill
            </button>
          </div>

          {billType === "NON_GST" ? (
            <div className="flex flex-col gap-2">
              <CheckboxField checked={manualNonGstNumber} onChange={setManualNonGstNumber}>
                Enter bill number manually
              </CheckboxField>
              {manualNonGstNumber ? (
                <Field label="Bill Number">
                  {(id) => <Input id={id} name="billNumber" placeholder="e.g. NG-0059" required className="h-11" />}
                </Field>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Next bill number: <span className="font-semibold text-foreground">{nextNonGstNumber}</span>
                </p>
              )}
            </div>
          ) : (
            <div className="@container flex flex-col gap-4 rounded-xl border border-dashed p-3">
              <Field label="GST Bill Number">
                {(id) => <Input id={id} name="billNumber" placeholder="e.g. INV-0012" required className="h-11" />}
              </Field>
              <div role="group" aria-labelledby={rateLabelId} className="flex flex-col gap-2">
                <p id={rateLabelId} className="text-sm font-medium">
                  GST Rate
                </p>
                <div className="flex gap-2">
                  {TAX_RATES.map((r) => (
                    <ChoiceChip
                      key={r}
                      selected={gstPercentage === r}
                      onClick={() => setGstPercentage(r)}
                      className="flex-1 px-1"
                    >
                      {r}%
                    </ChoiceChip>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 @min-[420px]:grid-cols-2">
                <Field label="Seller GSTIN">
                  {(id) => <Input id={id} value={businessGstNumber ?? "Set in Settings"} disabled className="h-11" />}
                </Field>
                <Field label="Buyer GSTIN (Optional)">
                  {(id) => <Input id={id} name="buyerGstin" autoCapitalize="characters" className="h-11" />}
                </Field>
              </div>
            </div>
          )}

          {bankAccounts.length > 0 && (
            <Field label="Bank Account to Print on Bill">
              {(id) => (
                <NativeSelect id={id} name="bankAccountId" defaultValue={defaultBankId} className="h-11 min-w-0">
                  <option value="">None</option>
                  {bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          )}

          <CheckboxField checked={showCustomerPhone} onChange={setShowCustomerPhone}>
            Show customer&rsquo;s phone number on bill
          </CheckboxField>

          <Field label="Notes (Optional)">{(id) => <Input id={id} name="notes" className="h-11" />}</Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h2 className="mb-2 text-base font-semibold">Review Amount</h2>
          <dl className="flex flex-col gap-1.5 text-sm">
            {bucketHours > 0 && (
              <div className="flex justify-between gap-3 text-muted-foreground">
                <dt>Bucket Hours ({bucketHours} hrs)</dt>
                <dd className="shrink-0 tabular-nums">{formatCurrency(totals.bucketAmount)}</dd>
              </div>
            )}
            {breakerHours > 0 && (
              <div className="flex justify-between gap-3 text-muted-foreground">
                <dt>Breaker Hours ({breakerHours} hrs)</dt>
                <dd className="shrink-0 tabular-nums">{formatCurrency(totals.breakerAmount)}</dd>
              </div>
            )}
            {transportCharges > 0 && (
              <div className="flex justify-between gap-3 text-muted-foreground">
                <dt>Transport</dt>
                <dd className="shrink-0 tabular-nums">{formatCurrency(transportCharges)}</dd>
              </div>
            )}
            {billType === "GST" && (
              <div className="flex justify-between gap-3 text-muted-foreground">
                <dt>GST ({gstPercentage}%)</dt>
                <dd className="shrink-0 tabular-nums">{formatCurrency(totals.tax)}</dd>
              </div>
            )}
            {totals.dieselAdvance > 0 && (
              <div className="flex justify-between gap-3 text-muted-foreground">
                <dt>Diesel Advance</dt>
                <dd className="shrink-0 tabular-nums">-{formatCurrency(totals.dieselAdvance)}</dd>
              </div>
            )}
            <div className="mt-2 flex justify-between gap-3 border-t pt-2 text-lg font-bold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatCurrency(totals.total)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <SubmitBar
        mode="create"
        pending={pending}
        blocker={nothingBillable ? "Enter bucket hours, breaker hours or transport" : null}
        error={error}
        total={totals.total}
        idleLabel="Generate Bill"
        pendingLabel="Generating..."
        onPreview={() => {
          const form = formRef.current;
          if (!form || !form.reportValidity()) return;
          setPreview(Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v)])));
        }}
      />

      <BillPreviewDialog
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
        customerId={customerId}
        bankAccountId={preview?.bankAccountId ?? ""}
        pending={pending}
        blocker={nothingBillable ? "Enter bucket hours, breaker hours or transport" : null}
        onGenerate={() => {
          setPreview(null);
          formRef.current?.requestSubmit();
        }}
        bill={(() => {
          const ex = excavators.find((e) => e.id === preview?.excavatorId);
          const taxPaise = toPaise(totals.tax);
          const cgstPaise = Math.round(taxPaise / 2);
          const day = (v: string | undefined) => new Date(`${v || today}T00:00:00`);
          return {
            billNumber: billType === "NON_GST" && !manualNonGstNumber ? nextNonGstNumber : (preview?.billNumber ?? ""),
            billType,
            billDate: day(preview?.billDate),
            showCustomerPhone,
            buyerGstin: preview?.buyerGstin || null,
            items: [],
            subtotal: totals.subtotal,
            transportCharges,
            fuelCharges: 0,
            extraCharges: 0,
            bucketCharge: 0,
            breakerCharge: 0,
            discount: 0,
            gstPercentage: billType === "GST" ? gstPercentage : null,
            cgst: billType === "GST" ? fromPaise(cgstPaise) : null,
            sgst: billType === "GST" ? fromPaise(taxPaise - cgstPaise) : null,
            totalAmount: totals.total,
            notes: preview?.notes || null,
            isDirect: true,
            excavatorName: ex?.name ?? null,
            machineNumber: ex?.machineNumber ?? null,
            fromDate: day(preview?.fromDate),
            toDate: day(preview?.toDate),
            bucketHours,
            bucketRate,
            breakerHours,
            breakerRate,
            dieselLiters,
            dieselPricePerLiter,
            dieselAdvance: totals.dieselAdvance,
          };
        })()}
      />
    </form>
  );
}
