"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useApiForm } from "@/lib/use-api-form";
import { useIdempotencyKey } from "../use-idempotency-key";
import { siteRateFor, sitesForCustomer } from "../site-defaults";
import {
  buildPayload,
  computeTotals,
  fromDatePatch,
  machinePatch,
  newRowFrom,
  parseNumberPaste,
  pasteDown,
  quickFillRows,
  submitBlocker,
  todayIso,
  type RowContext,
} from "./bill-math";
import type {
  BillFields,
  BillFormInitial,
  BillFormOptions,
  BillType,
  Col,
  DirectFields,
  QuickFillParams,
  Row,
  RowOps,
} from "./types";

/** All state and behaviour of the bill editor: the form fields, the grid rows
 * and their operations, derived totals, and saving. The components only render
 * what this returns. */
export function useBillEditor({
  options,
  mode,
  billId,
  isDirect,
  initial,
}: {
  options: BillFormOptions;
  mode: "create" | "edit";
  billId?: string;
  isDirect: boolean;
  initial?: BillFormInitial;
}) {
  const router = useRouter();
  const keyRef = useRef((initial?.items.length ?? 0) + 1);
  const gridRef = useRef<HTMLDivElement>(null);

  const machineById = useMemo(() => new Map(options.excavators.map((e) => [e.id, e])), [options.excavators]);
  const siteByName = useMemo(
    () => new Map(options.sites.map((s) => [s.name.trim().toLowerCase(), s])),
    [options.sites],
  );
  /** The saved Site Analysis rate for a site name + tool, or null. */
  const autoRate = (siteName: string, attachment: string) =>
    siteRateFor(siteByName.get(siteName.trim().toLowerCase()), attachment);
  /** Default site for a row: the site linked to the chosen customer, else the machine's current site.
   * (`fields` is read when called, after it is declared below.) */
  const siteFor = (excavatorId: string) =>
    sitesForCustomer(options.sites, fields.customerId)[0]?.name || (machineById.get(excavatorId)?.currentSite?.name ?? "");
  /** A row with no rate takes its site's saved rate for its tool. */
  const withAutoRate = (row: Row): Row => {
    if (row.rate) return row;
    const rate = autoRate(row.siteName, row.attachment);
    return rate != null ? { ...row, rate: String(rate) } : row;
  };
  const rowContext = (): RowContext => ({
    makeKey: () => keyRef.current++,
    firstMachineId: options.excavators[0]?.id ?? "",
    siteFor,
    today: todayIso(),
  });

  const defaultBank = (type: BillType) =>
    options.bankAccounts.find((b) => (type === "GST" ? b.isDefaultForGst : b.isDefaultForNonGst))?.id ?? "";

  const [fields, setFields] = useState<BillFields>(() => ({
    customerId: initial?.customerId ?? "",
    billDate: initial?.billDate ?? todayIso(),
    transport: String(initial?.transportCharges || ""),
    fuel: String(initial?.fuelCharges || ""),
    extra: String(initial?.extraCharges || ""),
    bucket: String(initial?.bucketCharge || ""),
    breaker: String(initial?.breakerCharge || ""),
    discount: String(initial?.discount || ""),
    billType: initial?.billType ?? "NON_GST",
    gstPercentage: initial?.gstPercentage ?? 18,
    manualNumber: false,
    billNumber: initial?.billNumber ?? "",
    buyerGstin: initial?.buyerGstin ?? "",
    bankAccountId: initial ? initial.bankAccountId : defaultBank("NON_GST"),
    notes: initial?.notes ?? "",
    showCustomerPhone: initial?.showCustomerPhone ?? true,
    dieselLiters: String(initial?.dieselLiters || ""),
    dieselRate: String(initial?.dieselPricePerLiter || ""),
    deductDiesel: initial?.deductDiesel ?? true,
  }));
  const setField = <K extends keyof BillFields>(key: K, value: BillFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));
  const customerSite = sitesForCustomer(options.sites, fields.customerId)[0];
  /** Choosing the customer fills their site (and its rates) into rows that have none yet. */
  const setCustomer = (customerId: string) => {
    setField("customerId", customerId);
    if (mode !== "create") return;
    const site = sitesForCustomer(options.sites, customerId)[0];
    if (!site) return;
    setRows((prev) => prev.map((r) => withAutoRate(r.siteName ? r : { ...r, siteName: site.name })));
  };
  /** A new bill follows the default bank account of the chosen bill type. */
  const setBillType = (type: BillType) =>
    setFields((f) => ({ ...f, billType: type, bankAccountId: mode === "create" ? defaultBank(type) : f.bankAccountId }));

  // Bucket/breaker charges only exist on older bills. Their fields are shown for
  // as long as the form is open (not only while non-zero), so clearing one to
  // retype it does not make the field vanish under the cursor.
  const [legacyCharges] = useState({
    bucket: (initial?.bucketCharge ?? 0) > 0,
    breaker: (initial?.breakerCharge ?? 0) > 0,
  });

  const [direct, setDirect] = useState<DirectFields>(() => ({
    excavatorId: initial?.excavatorId ?? "",
    fromDate: initial?.fromDate ?? todayIso(),
    toDate: initial?.toDate ?? todayIso(),
    bucketHours: String(initial?.bucketHours || ""),
    bucketRate: String(initial?.bucketRate || ""),
    breakerHours: String(initial?.breakerHours || ""),
    breakerRate: String(initial?.breakerRate || ""),
  }));
  const setDirectField = <K extends keyof DirectFields>(key: K, value: DirectFields[K]) =>
    setDirect((d) => ({ ...d, [key]: value }));

  const [rows, setRows] = useState<Row[]>(() =>
    (initial?.items ?? []).map((i, idx) => ({
      key: idx + 1,
      id: i.id,
      excavatorId: i.excavatorId,
      siteName: i.siteName,
      fromDate: i.fromDate,
      toDate: i.toDate,
      hours: String(i.hours),
      rate: String(i.ratePerHour),
      attachment: i.attachment,
    })),
  );

  // ---- grid ----------------------------------------------------------------

  const focusCell = (rowIndex: number, col: Col) => {
    requestAnimationFrame(() => {
      const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${rowIndex}-${col}"]`);
      el?.focus();
      if (el instanceof HTMLInputElement) el.select();
    });
  };

  const rowOps: RowOps = {
    // Changing a row's site or tool moves its rate to that site's saved rate, unless the
    // owner typed a rate of their own.
    update: (key, patch) =>
      setRows((prev) =>
        prev.map((r) => {
          if (r.key !== key) return r;
          const next = { ...r, ...patch };
          if ("siteName" in patch || "attachment" in patch) {
            const before = autoRate(r.siteName, r.attachment);
            const after = autoRate(next.siteName, next.attachment);
            if (after != null && (!r.rate || Number(r.rate) === before)) next.rate = String(after);
          }
          return next;
        }),
      ),
    setMachine: (key, excavatorId) =>
      setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...machinePatch(r, excavatorId, siteFor) } : r))),
    setFromDate: (key, fromDate) =>
      setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...fromDatePatch(r, fromDate) } : r))),
    add: () => setRows((prev) => [...prev, withAutoRate(newRowFrom(prev[prev.length - 1], rowContext()))]),
    duplicate: (key) =>
      setRows((prev) => {
        const i = prev.findIndex((r) => r.key === key);
        if (i < 0) return prev;
        const copy = { ...newRowFrom(prev[i], rowContext()), id: undefined };
        return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
      }),
    remove: (key) => setRows((prev) => prev.filter((r) => r.key !== key)),
    applyRateToAll: (rate) => setRows((prev) => prev.map((r) => ({ ...r, rate }))),
    // Enter moves to the same cell on the next row (adding a copied row at the
    // end) instead of submitting the form.
    onCellKeyDown: (e, rowIndex, col) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (rowIndex === rows.length - 1) rowOps.add();
      focusCell(rowIndex + 1, col);
    },
    // Pasting a column (or a row) copied from Excel/Sheets into hours or rate
    // fills downward from the current row, adding rows as needed.
    onNumberPaste: (e, rowIndex, col) => {
      const values = parseNumberPaste(e.clipboardData.getData("text"));
      if (!values) return;
      e.preventDefault();
      setRows((prev) => pasteDown(prev, rowIndex, col, values, rowContext()));
    },
  };

  /** Quick Fill: appends the generated rows. Returns an error message, or null. */
  const addQuickFillRows = (params: QuickFillParams): string | null => {
    const result = quickFillRows(params, rowContext());
    if ("error" in result) return result.error;
    setRows((prev) => [...prev, ...result.rows.map(withAutoRate)]);
    return null;
  };

  // ---- derived -------------------------------------------------------------

  const totals = useMemo(
    () => computeTotals({ isDirect, rows, direct, fields }),
    [isDirect, rows, direct, fields],
  );
  const blocker = submitBlocker({ mode, isDirect, fields, rows });

  // ---- submit --------------------------------------------------------------

  // The version the form's data was loaded at, fixed for this form's lifetime —
  // a later revalidation must not silently "update" it, or the check that
  // detects someone else's change in the meantime would be defeated.
  const [loadedVersion] = useState(initial?.version);
  const [conflict, setConflict] = useState(false);
  // Create mode: one Idempotency-Key per submission, kept across retries.
  const idem = useIdempotencyKey();

  const refreshLists = () =>
    mutate((k) => typeof k === "string" && (k.startsWith("/api/bills") || k.startsWith("/api/dashboard")));

  const { error, pending, run } = useApiForm(async (body: Record<string, unknown>) => {
    setConflict(false);
    if (mode === "edit") {
      try {
        await apiFetch(`/api/bills/${billId}`, {
          method: "PATCH",
          body: JSON.stringify({ ...body, expectedVersion: loadedVersion }),
        });
      } catch (err) {
        if (err instanceof ApiError && err.code === "RESOURCE_MODIFIED") setConflict(true);
        throw err;
      }
      await refreshLists();
      router.push(`/bills/detail?id=${billId}`);
    } else {
      const { bill } = await idem.submit((idempotencyKey) =>
        apiFetch<{ bill: { id: string } }>("/api/bills/summary", {
          method: "POST",
          body: JSON.stringify(body),
          idempotencyKey,
        }),
      );
      await refreshLists();
      router.push(`/bills/detail?id=${bill.id}`);
    }
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await run(buildPayload({ mode, isDirect, fields, direct, rows }));
  }

  return {
    setCustomer,
    customerSite,
    mode,
    isDirect,
    fields,
    setField,
    setBillType,
    direct,
    setDirectField,
    rows,
    rowOps,
    gridRef,
    addQuickFillRows,
    totals,
    blocker,
    canSubmit: blocker === null,
    legacyCharges,
    onSubmit,
    pending,
    error,
    conflict,
  };
}

export type BillEditor = ReturnType<typeof useBillEditor>;
