"use client";

import { useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { BillPreviewDialog } from "./bill-preview-dialog";
import { lineAmountRupees } from "./money-preview";
import { BillHeader } from "./editor/bill-header";
import { BillItemsSection } from "./editor/bill-items-section";
import { BillSummary } from "./editor/bill-summary";
import { DieselDeduction } from "./editor/diesel-fields";
import { DirectBillFields } from "./editor/direct-bill-fields";
import { ExtraCharges } from "./editor/extra-charges";
import { SiteSuggestions } from "./editor/form-parts";
import { QuickFill } from "./editor/quick-fill";
import { SubmitBar } from "./editor/submit-bar";
import { TaxSection } from "./editor/tax-section";
import type { BillFormInitial, BillFormOptions } from "./editor/types";
import { useBillEditor } from "./editor/use-bill-editor";

export type { BillFormInitial, BillFormOptions };

/** One form for both "Summary Bill" creation and editing any existing bill
 * (normal/summary bills are an Excel-like grid of rows; direct bills have their
 * own fields). All state and rules live in useBillEditor; this only lays the
 * sections out. The grid is built for speed: Quick Fill generates a whole date
 * range for several machines at once, Enter moves down a column (adding a copied
 * row at the end), pasting a column from Excel fills downward, and
 * rate/site/dates carry over from the row above. Below `md` the grid becomes a
 * stack of cards. */
export function BillEditorForm({
  options,
  mode,
  billId,
  isDirect = false,
  initial,
  onReloadLatest,
}: {
  options: BillFormOptions;
  mode: "create" | "edit";
  billId?: string;
  isDirect?: boolean;
  initial?: BillFormInitial;
  /** Edit mode: re-fetch the bill and restart the form from it (offered after a conflict). */
  onReloadLatest?: () => void;
}) {
  const editor = useBillEditor({ options, mode, billId, isDirect, initial });
  const { fields, setField } = editor;
  const formRef = useRef<HTMLFormElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const n = (v: string) => Number(v) || 0;
  const machine = (id: string) => options.excavators.find((e) => e.id === id);
  const directMachine = machine(editor.direct.excavatorId);
  const taxPaise = Math.round(editor.totals.tax * 100);
  const cgstPaise = Math.round(taxPaise / 2);

  return (
    <form ref={formRef} onSubmit={editor.onSubmit} className="flex flex-col gap-4">
      <BillHeader
        customers={options.customers}
        customerId={fields.customerId}
        billDate={fields.billDate}
        onCustomerChange={editor.setCustomer}
        onDateChange={(date) => setField("billDate", date)}
      />

      {isDirect ? (
        <DirectBillFields
          excavators={options.excavators}
          direct={editor.direct}
          transport={fields.transport}
          onChange={editor.setDirectField}
          onTransportChange={(v) => setField("transport", v)}
        />
      ) : (
        <>
          <SiteSuggestions sites={options.sites} />
          <QuickFill
            key={editor.customerSite?.id ?? "none"}
            excavators={options.excavators}
            sites={options.sites}
            defaultSite={editor.customerSite}
            onAdd={editor.addQuickFillRows}
          />
          <BillItemsSection
            rows={editor.rows}
            excavators={options.excavators}
            totals={editor.totals}
            ops={editor.rowOps}
            gridRef={editor.gridRef}
          />
          <ExtraCharges fields={fields} legacy={editor.legacyCharges} onChange={(key, v) => setField(key, v)} />
        </>
      )}

      <Card>
        <CardContent className="flex flex-col gap-4">
          <h2 className="text-base font-semibold">Diesel Supplied by Customer</h2>
          <DieselDeduction
            liters={fields.dieselLiters}
            rate={fields.dieselRate}
            deduct={fields.deductDiesel}
            advance={editor.totals.dieselAdvance}
            onLitersChange={(v) => setField("dieselLiters", v)}
            onRateChange={(v) => setField("dieselRate", v)}
            onDeductChange={(v) => setField("deductDiesel", v)}
          />
        </CardContent>
      </Card>

      <TaxSection
        mode={mode}
        options={options}
        fields={fields}
        onChange={setField}
        onBillTypeChange={editor.setBillType}
      />
      <BillSummary
        totals={editor.totals}
        isDirect={isDirect}
        billType={fields.billType}
        gstPercentage={fields.gstPercentage}
      />
      <SubmitBar
        mode={mode}
        pending={editor.pending}
        blocker={editor.blocker}
        error={editor.error}
        conflict={editor.conflict}
        onReloadLatest={onReloadLatest}
        total={editor.totals.total}
        onPreview={() => {
          if (formRef.current?.reportValidity()) setPreviewOpen(true);
        }}
      />

      <BillPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        customerId={fields.customerId}
        bankAccountId={fields.bankAccountId}
        pending={editor.pending}
        blocker={editor.blocker}
        onGenerate={() => {
          setPreviewOpen(false);
          formRef.current?.requestSubmit();
        }}
        bill={{
          billNumber:
            fields.manualNumber || fields.billType === "GST" || mode === "edit"
              ? fields.billNumber
              : options.nextNonGstNumber,
          billType: fields.billType,
          billDate: new Date(`${fields.billDate}T00:00:00`),
          showCustomerPhone: fields.showCustomerPhone,
          buyerGstin: fields.buyerGstin || null,
          items: isDirect
            ? []
            : editor.rows.map((r) => ({
                excavatorName: machine(r.excavatorId)?.name ?? "",
                machineNumber: machine(r.excavatorId)?.machineNumber ?? null,
                attachment: r.attachment || null,
                siteName: r.siteName,
                fromDate: new Date(`${r.fromDate}T00:00:00`),
                toDate: new Date(`${r.toDate}T00:00:00`),
                hours: n(r.hours),
                ratePerHour: n(r.rate),
                amount: lineAmountRupees(n(r.hours), n(r.rate)),
              })),
          subtotal: editor.totals.subtotal,
          transportCharges: n(fields.transport),
          fuelCharges: isDirect ? 0 : n(fields.fuel),
          extraCharges: isDirect ? 0 : n(fields.extra),
          bucketCharge: isDirect ? 0 : n(fields.bucket),
          breakerCharge: isDirect ? 0 : n(fields.breaker),
          discount: isDirect ? 0 : n(fields.discount),
          gstPercentage: fields.billType === "GST" ? fields.gstPercentage : null,
          cgst: fields.billType === "GST" ? cgstPaise / 100 : null,
          sgst: fields.billType === "GST" ? (taxPaise - cgstPaise) / 100 : null,
          totalAmount: editor.totals.total,
          notes: fields.notes || null,
          isDirect,
          excavatorName: directMachine?.name ?? null,
          machineNumber: directMachine?.machineNumber ?? null,
          fromDate: isDirect ? new Date(`${editor.direct.fromDate}T00:00:00`) : null,
          toDate: isDirect ? new Date(`${editor.direct.toDate}T00:00:00`) : null,
          bucketHours: n(editor.direct.bucketHours),
          bucketRate: n(editor.direct.bucketRate),
          breakerHours: n(editor.direct.breakerHours),
          breakerRate: n(editor.direct.breakerRate),
          dieselLiters: n(fields.dieselLiters),
          dieselPricePerLiter: n(fields.dieselRate),
          dieselAdvance: editor.totals.dieselAdvance,
        }}
      />
    </form>
  );
}
