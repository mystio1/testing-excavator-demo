"use client";

import { useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { Square } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useApiForm } from "@/lib/use-api-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function StopWorkDialog({
  excavatorId,
  workSessionId,
  version,
  currentHourMeter,
  startDate,
}: {
  excavatorId: string;
  workSessionId: string;
  /** The job's version as loaded: stopping a job someone else just changed is a conflict. */
  version?: number;
  currentHourMeter: number;
  /** The day the job started — most work is stopped on the day it began, and
   * a job entered days later must not be dated today by accident. */
  startDate: Date | string;
}) {
  const { mutate } = useSWRConfig();
  // Work dates are stored as the UTC midnight of the chosen day.
  const startDateValue = new Date(startDate).toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [confirmSkipRemaining, setConfirmSkipRemaining] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { error, pending, run } = useApiForm(async (body: Record<string, unknown>) => {
    await apiFetch(`/api/excavators/${excavatorId}/stop-work`, { method: "POST", body: JSON.stringify(body) });
  });

  async function doSubmit(fd: FormData, skipRemainingCheck = false) {
    const diesel = fd.get("dieselLiters");
    const remaining = fd.get("remainingDieselLiters");
    if (!skipRemainingCheck && diesel && !remaining) {
      setConfirmSkipRemaining(true);
      return;
    }
    const ok = await run({
      workSessionId,
      expectedVersion: version,
      endDate: fd.get("endDate"),
      endHourMeter: Number(fd.get("endHourMeter")),
      dieselLiters: diesel || undefined,
      remainingDieselLiters: remaining || undefined,
      notes: fd.get("notes") || undefined,
    });
    if (ok) {
      await mutate(`/api/excavators/${excavatorId}`);
      setOpen(false);
    }
  }

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (!v) setConfirmSkipRemaining(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        data-agent-id="stop-work-trigger"
        render={
          <Button
            size="lg"
            variant="outline"
            className="h-12 flex-1 border-destructive text-destructive text-base hover:bg-destructive/10"
          />
        }
      >
        <Square className="size-5" />
        Stop Work
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop Work</DialogTitle>
        </DialogHeader>
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); doSubmit(new FormData(e.currentTarget)); }} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="endDate" className="text-base">
              End Date
            </Label>
            <Input
              key={startDateValue}
              id="endDate" data-agent-id="stop-endDate"
              name="endDate"
              type="date"
              defaultValue={startDateValue}
              min={startDateValue}
              required
              className="h-12 text-base"
            />
            <p className="text-xs text-muted-foreground">
              Leave as is if the work ended on the day it started.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="endHourMeter" className="text-base">
              Final Hour Meter
            </Label>
            <Input
              id="endHourMeter" data-agent-id="stop-endHourMeter"
              name="endHourMeter"
              type="number"
              step="0.1"
              min="0"
              defaultValue={currentHourMeter}
              required
              className="h-12 text-base"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="stopWork-dieselLiters" className="text-base">
                Diesel Taken (L)
              </Label>
              <Input
                id="stopWork-dieselLiters"
                name="dieselLiters"
                type="number"
                step="0.1"
                min="0"
                className="h-12 text-base"
                onChange={() => setConfirmSkipRemaining(false)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="stopWork-remainingDiesel" className="text-base">
                Diesel left in tank (L)
              </Label>
              <Input
                id="stopWork-remainingDiesel"
                name="remainingDieselLiters"
                type="number"
                step="0.1"
                min="0"
                placeholder="e.g. 70"
                className="h-12 text-base"
                onChange={() => setConfirmSkipRemaining(false)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Litres still in the tank at the end of the work — enables consumption rate &amp; runtime prediction.
          </p>

          {confirmSkipRemaining && (
            <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-3 text-sm">
              <p className="font-semibold text-amber-700 dark:text-amber-300">No remaining diesel entered</p>
              <p className="mt-1 text-amber-700/80 dark:text-amber-300/80">
                Without it the consumption rate can&apos;t be calculated. Skip anyway?
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => { if (formRef.current) doSubmit(new FormData(formRef.current), true); }}
                  className="flex-1 rounded-lg bg-amber-500 py-2 text-sm font-semibold text-white"
                >
                  Yes, skip
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmSkipRemaining(false)}
                  className="flex-1 rounded-lg bg-muted py-2 text-sm font-semibold text-foreground"
                >
                  Enter it
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="stopWorkNotes" className="text-base">
              Note (Optional)
            </Label>
            <Input id="stopWorkNotes" name="notes" className="h-12 text-base" />
          </div>

          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}

          {!confirmSkipRemaining && (
            <DialogFooter className="-mx-0 -mb-0 rounded-none border-0 bg-transparent p-0 sm:justify-stretch">
              <Button type="submit" data-agent-id="stop-work-submit" size="lg" className="h-12 w-full text-base" disabled={pending}>
                {pending ? "Stopping..." : "Confirm Stop Work"}
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
