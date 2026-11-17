"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { Pencil } from "lucide-react";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useApiForm } from "@/lib/use-api-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AttachmentPicker } from "@/components/attachment-picker";
import { WorkTotalHours, formTotalHours, workTotalHours } from "@/components/work-total-hours";
import { TOOL_REQUIRED_MESSAGE } from "@/lib/attachments";
import { ChangeReview } from "@/components/change-review";
import { summarizeChanges, type FieldChange } from "@/lib/utils/change-summary";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export type EditableLog = {
  id: string;
  /** Optimistic-concurrency token: sent back as expectedVersion on save. */
  version: number;
  date: string | Date;
  startTime: string | null;
  stopTime: string | null;
  breakMinutes: number | null;
  startHourMeter: number | null;
  endHourMeter: number | null;
  operatorName: string | null;
  dieselLiters: number | null;
  notes: string | null;
  attachment: string | null;
};

/** Admin can correct any reading at any time — pending, approved or
 * rejected; hours, session totals and diesel re-derive server-side. */
export function EditReadingButton({ log, invalidateKey }: { log: EditableLog; invalidateKey: string }) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"meter" | "time">(
    log.startHourMeter != null && log.endHourMeter != null ? "meter" : "time",
  );
  // The version the dialog was opened with (see EditSessionButton).
  const [loadedVersion, setLoadedVersion] = useState(log.version);
  const [conflict, setConflict] = useState(false);
  const [review, setReview] = useState<{ body: Record<string, unknown>; changes: FieldChange[] } | null>(null);
  const [nothingChanged, setNothingChanged] = useState(false);
  const [toolError, setToolError] = useState<string | null>(null);
  const formId = `edit-reading-form-${log.id}`;
  /** Seeded from the stored reading so the total is right the moment the
   * dialog opens, then recomputed from the form on every edit. */
  const [totalHours, setTotalHours] = useState<number | null>(() => storedHours(log));
  const { error, pending, run } = useApiForm(async (body: Record<string, unknown>) => {
    setConflict(false);
    try {
      await apiFetch(`/api/daily-logs/${log.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...body, expectedVersion: loadedVersion }),
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === "RESOURCE_MODIFIED") setConflict(true);
      throw e;
    }
  });

  function onOpenChange(next: boolean) {
    if (next) {
      setLoadedVersion(log.version);
      setConflict(false);
      setReview(null);
      setNothingChanged(false);
      setToolError(null);
      setTotalHours(storedHours(log));
    }
    setOpen(next);
  }

  /** After a conflict: fetch the latest data and close, so reopening shows it. */
  async function reloadLatest() {
    await mutate(invalidateKey);
    await mutate((key) => typeof key === "string" && key.startsWith("/api/excavators"));
    setOpen(false);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Compulsory here too: a correction must not be the way an entry loses the
    // tool it was saved with (Site Analysis prices hours by it).
    if (!fd.get("attachment")) {
      setToolError(TOOL_REQUIRED_MESSAGE);
      return;
    }
    const body = {
      date: fd.get("date"),
      startHourMeter: mode === "meter" ? fd.get("startHourMeter") || undefined : undefined,
      endHourMeter: mode === "meter" ? fd.get("endHourMeter") || undefined : undefined,
      startTime: mode === "time" ? fd.get("startTime") || undefined : undefined,
      stopTime: mode === "time" ? fd.get("stopTime") || undefined : undefined,
      breakMinutes: mode === "time" ? fd.get("breakMinutes") || undefined : undefined,
      operatorName: fd.get("operatorName") || undefined,
      dieselLiters: fd.get("dieselLiters") || undefined,
      notes: fd.get("notes") || undefined,
      attachment: fd.get("attachment"),
    };
    const timeBased = mode === "time";
    const changes = summarizeChanges([
      { label: "Date", before: new Date(log.date).toISOString().slice(0, 10), after: body.date },
      ...(timeBased
        ? [
            { label: "Start time", before: log.startTime, after: body.startTime },
            { label: "Stop time", before: log.stopTime, after: body.stopTime },
            { label: "Break (minutes)", before: log.breakMinutes ?? 0, after: body.breakMinutes ?? 0 },
          ]
        : [
            { label: "Start meter", before: log.startHourMeter, after: body.startHourMeter },
            { label: "End meter", before: log.endHourMeter, after: body.endHourMeter },
          ]),
      { label: "Operator", before: log.operatorName, after: body.operatorName },
      { label: "Tool / attachment", before: log.attachment, after: body.attachment },
      { label: "Diesel (L)", before: log.dieselLiters, after: body.dieselLiters },
      { label: "Note", before: log.notes, after: body.notes },
    ]);
    setNothingChanged(changes.length === 0);
    if (changes.length > 0) setReview({ body, changes });
  }

  /** The admin answered "Yes" to "Are you sure you want to change this?". */
  async function confirmSave() {
    if (!review) return;
    const ok = await run(review.body);
    if (ok) {
      await mutate(invalidateKey);
      await mutate((key) => typeof key === "string" && (key.startsWith("/api/excavators") || key.startsWith("/api/customers")));
      setReview(null);
      setOpen(false);
    }
  }

  const dateValue = new Date(log.date).toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Edit reading"
          />
        }
      >
        <Pencil className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Reading</DialogTitle>
        </DialogHeader>
        {review && (
          <ChangeReview
            changes={review.changes}
            pending={pending}
            error={error}
            note="Hours, the job's total and diesel are recalculated from the readings after saving."
            onBack={() => setReview(null)}
            onConfirm={confirmSave}
          />
        )}
        {/* Kept mounted (just hidden) while confirming, so "No, go back" returns to exactly what was typed. */}
        <form
          id={formId}
          onSubmit={onSubmit}
          onChange={(e) => setTotalHours(formTotalHours(e.currentTarget, mode))}
          className={review ? "hidden" : "flex flex-col gap-4"}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="date" className="text-base">Date</Label>
            <Input id="date" name="date" type="date" defaultValue={dateValue} required className="h-12 text-base" />
          </div>

          <div className="flex gap-2 rounded-lg bg-muted p-1">
            {(["meter", "time"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => {
                  setMode(m);
                  const form = document.getElementById(formId) as HTMLFormElement | null;
                  if (form) setTotalHours(formTotalHours(form, m));
                }}
                className={cn(
                  "min-h-10 flex-1 rounded-md py-2 text-sm font-semibold",
                  mode === m ? "bg-background shadow-sm" : "text-muted-foreground",
                )}
              >
                {m === "meter" ? "Hour Meter" : "Start / Stop Time"}
              </button>
            ))}
          </div>

          {mode === "meter" ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="startHourMeter" className="text-base">Start Meter</Label>
                <Input id="startHourMeter" name="startHourMeter" type="number" step="0.1" min="0" defaultValue={log.startHourMeter ?? ""} className="h-12 text-base" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="endHourMeter" className="text-base">End Meter</Label>
                <Input id="endHourMeter" name="endHourMeter" type="number" step="0.1" min="0" defaultValue={log.endHourMeter ?? ""} className="h-12 text-base" />
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="startTime" className="text-base">Start Time</Label>
                  <Input id="startTime" name="startTime" type="time" defaultValue={log.startTime ?? ""} className="h-12 text-base" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="stopTime" className="text-base">Stop Time</Label>
                  <Input id="stopTime" name="stopTime" type="time" defaultValue={log.stopTime ?? ""} className="h-12 text-base" />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="breakMinutes" className="text-base">Break (Minutes)</Label>
                <Input id="breakMinutes" name="breakMinutes" type="number" step="1" min="0" defaultValue={log.breakMinutes ?? 0} className="h-12 text-base" />
              </div>
            </>
          )}

          <WorkTotalHours hours={totalHours} mode={mode} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="operatorName" className="text-base">Operator Name (Optional)</Label>
            <Input id="operatorName" name="operatorName" defaultValue={log.operatorName ?? ""} className="h-12 text-base" />
          </div>

          <AttachmentPicker
            name="attachment"
            label="Attachment / Tool Used"
            required
            error={toolError}
            onValueChange={() => setToolError(null)}
            defaultValue={log.attachment ?? undefined}
          />

          <div className="flex flex-col gap-2">
            <Label htmlFor="dieselLiters" className="text-base">Diesel Taken (L) (Optional)</Label>
            <Input id="dieselLiters" name="dieselLiters" type="number" step="0.1" min="0" defaultValue={log.dieselLiters ?? ""} className="h-12 text-base" />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="notes" className="text-base">Note (Optional)</Label>
            <Input id="notes" name="notes" defaultValue={log.notes ?? ""} className="h-12 text-base" />
          </div>

          {nothingChanged && !review && <p role="status" className="text-sm text-muted-foreground">Nothing was changed.</p>}
          {!review && error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
          {conflict && (
            <Button type="button" variant="outline" className="h-11" onClick={reloadLatest}>
              Reload latest version
            </Button>
          )}

          <DialogFooter className="-mx-0 -mb-0 rounded-none border-0 bg-transparent p-0 sm:justify-stretch">
            <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={pending}>
              {pending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The hours the stored reading already represents, by whichever of the two
 * ways it was recorded. */
function storedHours(log: EditableLog): number | null {
  return workTotalHours(
    log.startHourMeter != null && log.endHourMeter != null
      ? { mode: "meter", startHourMeter: log.startHourMeter, endHourMeter: log.endHourMeter }
      : { mode: "time", startTime: log.startTime, stopTime: log.stopTime, breakMinutes: log.breakMinutes },
  );
}
