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
import { formatDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";
import { fromPaise, gstTaxPaise, lineAmountPaise, toPaise } from "@/components/bill/money-preview";
import { useIdempotencyKey } from "@/components/bill/use-idempotency-key";
import { TAX_RATES } from "@/components/bill/editor/bill-math";
import { CheckboxField, ChoiceChip, Field } from "@/components/bill/editor/form-parts";
import { SubmitBar } from "@/components/bill/editor/submit-bar";
import { DieselDeduction } from "@/components/bill/editor/diesel-fields";
import { BillPreviewDialog } from "@/components/bill/bill-preview-dialog";
import { mainAttachment, siteRateFor, sitesForCustomer, type SiteOption } from "@/components/bill/site-defaults";

import { todayLocal } from "@/lib/utils/dates";
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

type BankAccount = {
  id: string;
  label: string;
  isDefaultForGst: boolean;
  isDefaultForNonGst: boolean;
};

export function GenerateBillForm({
  customerId,
  sites,
  sessions,
  bankAccounts,
  businessGstNumber,
  nextNonGstNumber,
}: {
  customerId: string;
  sites: SiteOption[];
  sessions: Session[];
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
      apiFetch<{ bill: { id: string } }>("/api/bills", {
        method: "POST",
        body: JSON.stringify(body),
        idempotencyKey,
      }),
    );
    router.push(`/bills/detail?id=${bill.id}`);
  });

  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(sessions.map((s) => [s.id, true])),
  );
  // Defaults from Site Analysis: the site these records are at (or the site linked to the
  // customer), its saved rate for the main tool, and its name to print. All stay editable.
  const defaults = useMemo(() => {
    const siteIds = [...new Set(sessions.map((s) => s.siteId))];
    const linked = sitesForCustomer(sites, customerId)[0];
    const rateSite = siteIds.length === 1 ? sites.find((x) => x.id === siteIds[0]) : siteIds.length === 0 ? linked : undefined;
    const tool =
      mainAttachment(sessions) ??
      (rateSite?.bucketRate ? "Bucket" : rateSite?.breakerRate ? "Breaker" : null);
    return {
      rateSite,
      siteName: siteIds.length === 1 ? sessions[0].siteName : siteIds.length === 0 ? (linked?.name ?? "") : "",
      attachment: tool ?? "",
      rate: siteRateFor(rateSite, tool) ?? 0,
    };
  }, [sessions, sites, customerId]);
  const [siteName, setSiteName] = useState(defaults.siteName);
  const [ratePerHour, setRatePerHour] = useState(defaults.rate);
  const [transportCharges, setTransportCharges] = useState(0);
  const [fuelCharges, setFuelCharges] = useState(0);
  const [extraCharges, setExtraCharges] = useState(0);
  const [attachment, setAttachment] = useState(defaults.attachment);
  /** A rate the owner has not overridden follows the tool: Bucket rate <-> Breaker rate. */
  function changeAttachment(next: string) {
    const autoRate = siteRateFor(defaults.rateSite, attachment) ?? 0;
    const nextRate = siteRateFor(defaults.rateSite, next);
    if (nextRate != null && (ratePerHour === 0 || ratePerHour === autoRate)) setRatePerHour(nextRate);
    setAttachment(next);
  }
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<null | {
    billDate: string;
    billNumber: string;
    buyerGstin: string;
    notes: string;
    bankAccountId: string;
  }>(null);
  const [discount, setDiscount] = useState(0);
  const [dieselRate, setDieselRate] = useState("");
  const [deductDiesel, setDeductDiesel] = useState(true);
  const [billType, setBillType] = useState<"GST" | "NON_GST">("NON_GST");
  const [gstPercentage, setGstPercentage] = useState(18);
  const [manualNonGstNumber, setManualNonGstNumber] = useState(false);
  const [showCustomerPhone, setShowCustomerPhone] = useState(true);

  const defaultBankId =
    bankAccounts.find((b) => (billType === "GST" ? b.isDefaultForGst : b.isDefaultForNonGst))?.id ?? "";

  const selectedSessions = useMemo(() => sessions.filter((s) => selected[s.id]), [sessions, selected]);
  // Hours are summed in hundredths so 8.1 + 8.2 reads 16.3, not 16.299999999999997.
  const totalHours = fromPaise(selectedSessions.reduce((sum, s) => sum + toPaise(s.totalHours), 0));
  // Diesel already recorded against the selected work — the owner only prices it.
  const dieselLiters = fromPaise(selectedSessions.reduce((sum, s) => sum + toPaise(s.dieselLiters), 0));

  // Preview of what the server will store: each line is hours × rate rounded to
  // paise and the lines are summed (exact integer paise, see money-preview.ts).
  const totals = useMemo(() => {
    const subtotal = selectedSessions.reduce((sum, s) => sum + lineAmountPaise(s.totalHours, ratePerHour), 0);
    const taxable =
      subtotal + toPaise(transportCharges) + toPaise(fuelCharges) + toPaise(extraCharges) - toPaise(discount);
    const tax = billType === "GST" ? gstTaxPaise(taxable, gstPercentage) : 0;
    // Diesel the customer supplied is an advance, so it comes off after tax.
    const dieselAdvance = deductDiesel ? lineAmountPaise(dieselLiters, Number(dieselRate) || 0) : 0;
    return {
      subtotal: fromPaise(subtotal),
      taxable: fromPaise(taxable),
      tax: fromPaise(tax),
      dieselAdvance: fromPaise(dieselAdvance),
      total: fromPaise(taxable + tax - dieselAdvance),
    };
  }, [
    selectedSessions,
    ratePerHour,
    transportCharges,
    fuelCharges,
    extraCharges,
    discount,
    billType,
    gstPercentage,
    dieselLiters,
    dieselRate,
    deductDiesel,
  ]);

  const today = todayLocal();
  const noSelection = selectedSessions.length === 0;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await run({
      customerId,
      workSessionIds: fd.getAll("workSessionIds"),
      billDate: fd.get("billDate"),
      ratePerHour: Number(fd.get("ratePerHour")) || 0,
      transportCharges: Number(fd.get("transportCharges")) || 0,
      fuelCharges: Number(fd.get("fuelCharges")) || 0,
      extraCharges: Number(fd.get("extraCharges")) || 0,
      attachment: attachment || undefined,
      siteName: siteName.trim() || undefined,
      discount: Number(fd.get("discount")) || 0,
      dieselLiters,
      dieselPricePerLiter: Number(dieselRate) || 0,
      deductDiesel,
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
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h2 className="text-base font-semibold">Select Work Records</h2>
            {sessions.length > 0 && (
              <div className="flex gap-1 text-sm font-semibold text-amber-800 dark:text-primary">
                <button
                  type="button"
                  onClick={() => setSelected(Object.fromEntries(sessions.map((s) => [s.id, true])))}
                  disabled={selectedSessions.length === sessions.length}
                  className="min-h-11 rounded-lg px-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => setSelected({})}
                  disabled={selectedSessions.length === 0}
                  className="min-h-11 rounded-lg px-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  Deselect All
                </button>
              </div>
            )}
          </div>
          {sessions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No completed, unbilled work found for this customer yet.
            </p>
          )}
          {sessions.map((s) => (
            <label
              key={s.id}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent/40"
            >
              <input
                type="checkbox"
                name="workSessionIds"
                value={s.id}
                checked={!!selected[s.id]}
                onChange={(e) => setSelected((prev) => ({ ...prev, [s.id]: e.target.checked }))}
                className="mt-0.5 size-5 shrink-0"
              />
              <span className="min-w-0 flex-1 break-words">
                <span className="block font-semibold">
                  {s.excavatorName}
                  {s.machineNumber ? ` (${s.machineNumber})` : ""}
                </span>
                <span className="block text-muted-foreground">
                  {s.siteName} · {formatDate(new Date(s.startDate))} – {formatDate(new Date(s.endDate))}
                </span>
              </span>
              <span className="shrink-0 font-semibold whitespace-nowrap">{s.totalHours} hrs</span>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <h2 className="text-base font-semibold">Rate &amp; Charges</h2>
          <div className="@container">
            <div className="grid grid-cols-2 gap-x-3 gap-y-4">
              <Field label="Rate per Hour">
                {(id) => (
                  <Input
                    id={id}
                    name="ratePerHour"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="decimal"
                    value={ratePerHour || ""}
                    onChange={(e) => setRatePerHour(Number(e.target.value) || 0)}
                    className="h-11"
                  />
                )}
              </Field>
              <Field label="Attachment (Optional)">
                {(id) => (
                  <NativeSelect
                    id={id}
                    value={attachment}
                    onChange={(e) => changeAttachment(e.target.value)}
                    className="h-11 min-w-0"
                  >
                    <option value="">None</option>
                    <option value="Bucket">Bucket</option>
                    <option value="Breaker">Breaker</option>
                  </NativeSelect>
                )}
              </Field>
              <RateHint site={defaults.rateSite} />
              <Field label="Site Name on Bill" className="col-span-2">
                {(id) => (
                  <Input
                    id={id}
                    value={siteName}
                    onChange={(e) => setSiteName(e.target.value)}
                    placeholder="Each work record's own site"
                    className="h-11"
                  />
                )}
              </Field>
              <Field label="Bill Date" className="col-span-2 @min-[302px]:col-span-1">
                {(id) => <Input id={id} name="billDate" type="date" defaultValue={today} required className="h-11 px-2" />}
              </Field>
              <Field label="Transport Charges">
                {(id) => (
                  <Input
                    id={id}
                    name="transportCharges"
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={transportCharges || ""}
                    onChange={(e) => setTransportCharges(Number(e.target.value) || 0)}
                    className="h-11"
                  />
                )}
              </Field>
              <Field label="Fuel Charges">
                {(id) => (
                  <Input
                    id={id}
                    name="fuelCharges"
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={fuelCharges || ""}
                    onChange={(e) => setFuelCharges(Number(e.target.value) || 0)}
                    className="h-11"
                  />
                )}
              </Field>
              <Field label="Extra Charges">
                {(id) => (
                  <Input
                    id={id}
                    name="extraCharges"
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={extraCharges || ""}
                    onChange={(e) => setExtraCharges(Number(e.target.value) || 0)}
                    className="h-11"
                  />
                )}
              </Field>
              <Field label="Discount">
                {(id) => (
                  <Input
                    id={id}
                    name="discount"
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={discount || ""}
                    onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                    className="h-11"
                  />
                )}
              </Field>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <h2 className="text-base font-semibold">Diesel Supplied by Customer</h2>
          <DieselDeduction
            liters={String(dieselLiters)}
            rate={dieselRate}
            deduct={deductDiesel}
            advance={totals.dieselAdvance}
            onRateChange={setDieselRate}
            onDeductChange={setDeductDiesel}
            litersNote="Totalled from the diesel recorded on the selected work records."
          />
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
            <div className="flex justify-between gap-3 text-muted-foreground">
              <dt>Hours × Rate ({totalHours} hrs)</dt>
              <dd className="shrink-0 tabular-nums">{formatCurrency(totals.subtotal)}</dd>
            </div>
            {(transportCharges > 0 || fuelCharges > 0 || extraCharges > 0) && (
              <div className="flex justify-between gap-3 text-muted-foreground">
                <dt>Transport + Fuel + Extra</dt>
                <dd className="shrink-0 tabular-nums">
                  {formatCurrency(fromPaise(toPaise(transportCharges) + toPaise(fuelCharges) + toPaise(extraCharges)))}
                </dd>
              </div>
            )}
            {discount > 0 && (
              <div className="flex justify-between gap-3 text-muted-foreground">
                <dt>Discount</dt>
                <dd className="shrink-0 tabular-nums">-{formatCurrency(discount)}</dd>
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
                <dt>Diesel ({dieselLiters} L)</dt>
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
        blocker={noSelection ? "Select at least one work record" : null}
        error={error}
        total={totals.total}
        idleLabel="Generate Bill"
        pendingLabel="Generating..."
        onPreview={() => {
          const form = formRef.current;
          if (!form || !form.reportValidity()) return;
          const fd = new FormData(form);
          setPreview({
            billDate: String(fd.get("billDate") ?? today),
            billNumber: String(fd.get("billNumber") ?? ""),
            buyerGstin: String(fd.get("buyerGstin") ?? ""),
            notes: String(fd.get("notes") ?? ""),
            bankAccountId: String(fd.get("bankAccountId") ?? ""),
          });
        }}
      />

      <BillPreviewDialog
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
        customerId={customerId}
        bankAccountId={preview?.bankAccountId ?? ""}
        pending={pending}
        blocker={noSelection ? "Select at least one work record" : null}
        onGenerate={() => {
          setPreview(null);
          formRef.current?.requestSubmit();
        }}
        bill={{
          billNumber: billType === "NON_GST" && !manualNonGstNumber ? nextNonGstNumber : (preview?.billNumber ?? ""),
          billType,
          billDate: new Date(`${preview?.billDate ?? today}T00:00:00`),
          showCustomerPhone,
          buyerGstin: preview?.buyerGstin || null,
          items: selectedSessions.map((s) => ({
            excavatorName: s.excavatorName,
            machineNumber: s.machineNumber,
            attachment: attachment || null,
            siteName: siteName.trim() || s.siteName,
            fromDate: new Date(s.startDate),
            toDate: new Date(s.endDate),
            hours: s.totalHours,
            ratePerHour,
            amount: fromPaise(lineAmountPaise(s.totalHours, ratePerHour)),
          })),
          subtotal: totals.subtotal,
          transportCharges,
          fuelCharges,
          extraCharges,
          bucketCharge: 0,
          breakerCharge: 0,
          discount,
          gstPercentage: billType === "GST" ? gstPercentage : null,
          cgst: billType === "GST" ? fromPaise(Math.round(toPaise(totals.tax) / 2)) : null,
          sgst: billType === "GST" ? fromPaise(toPaise(totals.tax) - Math.round(toPaise(totals.tax) / 2)) : null,
          totalAmount: totals.total,
          notes: preview?.notes || null,
          dieselLiters,
          dieselPricePerLiter: Number(dieselRate) || 0,
          dieselAdvance: totals.dieselAdvance,
        }}
      />
    </form>
  );
}

/** What Site Analysis has saved for the site, so the owner can see where the rate came from. */
function RateHint({ site }: { site: SiteOption | undefined }) {
  if (!site) return null;
  const has = (r: number | null | undefined) => r != null && Number(r) > 0;
  return (
    <p className="col-span-2 -mt-2 text-xs text-muted-foreground">
      {has(site.bucketRate) || has(site.breakerRate) ? (
        <>
          Saved rates for <span className="font-semibold">{site.name}</span>:{" "}
          {[
            has(site.bucketRate) ? `Bucket ${formatCurrency(Number(site.bucketRate))}/hr` : null,
            has(site.breakerRate) ? `Breaker ${formatCurrency(Number(site.breakerRate))}/hr` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </>
      ) : (
        <span className="text-amber-700 dark:text-amber-400">
          No rate saved for {site.name} yet — enter it here, or save it in Site Analysis to fill it in next time.
        </span>
      )}
    </p>
  );
}
