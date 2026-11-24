"use client";

import { useId, useState } from "react";
import { Plus, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/native-select";
import { todayIso } from "./bill-math";
import { ChoiceChip, Field, FormAlert, SITE_LIST_ID, TOOL_OPTIONS } from "./form-parts";
import type { BillFormOptions, QuickFillParams } from "./types";
import { siteRateFor, type SiteOption } from "../site-defaults";

/** Generates rows for several machines over a date range in one go. The inputs
 * are scratch values of this panel only; `onAdd` appends the rows and returns an
 * error message when the request is not valid. */
export function QuickFill({
  excavators,
  sites = [],
  defaultSite,
  onAdd,
}: {
  excavators: BillFormOptions["excavators"];
  sites?: SiteOption[];
  /** The chosen customer's site: pre-fills Site and its saved rate (both editable). */
  defaultSite?: SiteOption;
  onAdd: (params: QuickFillParams) => string | null;
}) {
  const [machineIds, setMachineIds] = useState<string[]>([]);
  const [from, setFrom] = useState(todayIso);
  const [to, setTo] = useState(todayIso);
  const [hours, setHours] = useState("8");
  const initialTool = defaultSite?.bucketRate ? "Bucket" : defaultSite?.breakerRate ? "Breaker" : "";
  const [rate, setRate] = useState(() => String(siteRateFor(defaultSite, initialTool) ?? ""));
  const [site, setSite] = useState(defaultSite?.name ?? "");
  const [attachment, setAttachment] = useState(initialTool);
  const siteNamed = (name: string) => sites.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
  /** Follow the site's saved rate when site or tool changes, unless a rate of their own was typed. */
  const retarget = (nextSite: string, nextTool: string) => {
    const before = siteRateFor(siteNamed(site), attachment);
    const after = siteRateFor(siteNamed(nextSite), nextTool);
    if (after != null && (!rate || Number(rate) === before)) setRate(String(after));
  };
  const [perDay, setPerDay] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const machinesLabelId = useId();

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Zap aria-hidden className="size-4 text-primary" />
          <h2 className="text-base font-semibold">Quick Fill</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Pick machines and a date range — one row per day is created for each machine. Edit any cell afterwards.
        </p>

        <div role="group" aria-labelledby={machinesLabelId} className="flex flex-col gap-2">
          <p id={machinesLabelId} className="text-sm font-medium">
            Machines
          </p>
          <div className="flex flex-wrap gap-2">
            {excavators.map((m) => (
              <ChoiceChip
                key={m.id}
                selected={machineIds.includes(m.id)}
                onClick={() =>
                  setMachineIds((prev) => (prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id]))
                }
                className="max-w-full"
              >
                {m.name}
                {m.machineNumber ? ` (${m.machineNumber})` : ""}
              </ChoiceChip>
            ))}
            {excavators.length === 0 && <p className="text-sm text-muted-foreground">Add a machine first.</p>}
          </div>
        </div>

        <div className="@container">
          <div className="grid grid-cols-2 gap-3 @min-[480px]:grid-cols-3 @min-[880px]:grid-cols-6">
            <Field label="From" className="col-span-2 @min-[302px]:col-span-1">
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    if (to < e.target.value) setTo(e.target.value);
                  }}
                  className="h-11 px-2"
                />
              )}
            </Field>
            <Field label="To" className="col-span-2 @min-[302px]:col-span-1">
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={to}
                  min={from}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-11 px-2"
                />
              )}
            </Field>
            <Field label={perDay ? "Hours / day" : "Total hours"}>
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className="h-11"
                />
              )}
            </Field>
            <Field label="Rate / hour">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  className="h-11"
                />
              )}
            </Field>
            <Field label="Tool (optional)" className="col-span-2 @min-[302px]:col-span-1">
              {(id) => (
                <NativeSelect
                  id={id}
                  value={attachment}
                  onChange={(e) => {
                    retarget(site, e.target.value);
                    setAttachment(e.target.value);
                  }}
                  className="h-11 min-w-0"
                >
                  <option value="">None</option>
                  {TOOL_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Site (blank = machine’s site)" className="col-span-2">
              {(id) => <Input id={id} list={SITE_LIST_ID} value={site} onChange={(e) => {
                    retarget(e.target.value, attachment);
                    setSite(e.target.value);
                  }} className="h-11" />}
            </Field>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
          <fieldset className="flex flex-col sm:flex-row sm:gap-4">
            <legend className="sr-only">Rows to create</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
              <input
                type="radio"
                name="quick-fill-mode"
                checked={perDay}
                onChange={() => setPerDay(true)}
                className="size-5 shrink-0"
              />
              One row per day
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
              <input
                type="radio"
                name="quick-fill-mode"
                checked={!perDay}
                onChange={() => setPerDay(false)}
                className="size-5 shrink-0"
              />
              One row for whole period
            </label>
          </fieldset>
          <Button
            type="button"
            onClick={() => setError(onAdd({ machineIds, from, to, hours, rate, site, attachment, perDay }))}
            className="h-11 w-full sm:ml-auto sm:w-auto"
          >
            <Plus aria-hidden className="size-4" /> Add Rows
          </Button>
        </div>
        {error && <FormAlert>{error}</FormAlert>}
      </CardContent>
    </Card>
  );
}
