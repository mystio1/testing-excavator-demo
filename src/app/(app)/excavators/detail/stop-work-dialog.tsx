"use client";

import { useState } from "react";
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
  const { error, pending, run } = useApiForm(async (body: Record<string, unknown>) => {
    await apiFetch(`/api/excavators/${excavatorId}/stop-work`, { method: "POST", body: JSON.stringify(body) });
  });

  /** Saves on the first press. Diesel left in the tank is asked for once, on
   * the form; a blank one is accepted without a second question. */
  async function doSubmit(fd: FormData) {
    const diesel = fd.get("dieselLiters");
    const remaining = fd.get("remainingDieselLiters");
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
        <form onSubmit={(e) => { e.preventDefault(); doSubmit(new FormData(e.currentTarget)); }} className="flex flex-col gap-4">
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
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Litres still in the tank at the end of the work. Leave blank if you don&apos;t have it — it only makes
            the consumption rate exact.
          </p>

          <div className="flex flex-col gap-2">
            <Label htmlFor="stopWorkNotes" className="text-base">
              Note (Optional)
            </Label>
            <Input id="stopWorkNotes" name="notes" className="h-12 text-base" />
          </div>

          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}

          <DialogFooter className="-mx-0 -mb-0 rounded-none border-0 bg-transparent p-0 sm:justify-stretch">
            <Button type="submit" data-agent-id="stop-work-submit" size="lg" className="h-12 w-full text-base" disabled={pending}>
              {pending ? "Stopping..." : "Confirm Stop Work"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
