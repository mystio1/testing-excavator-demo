"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { Clock } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useApiForm } from "@/lib/use-api-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AttachmentPicker } from "@/components/attachment-picker";
import { WorkTotalHours, workTotalHours } from "@/components/work-total-hours";
import { TOOL_REQUIRED_MESSAGE } from "@/lib/attachments";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { todayLocal } from "@/lib/utils/dates";
export function AddDailyLogDialog({
  excavatorId,
  workSessionId,
  currentHourMeter,
}: {
  excavatorId: string;
  workSessionId: string;
  currentHourMeter: number;
}) {
  const { mutate } = useSWRConfig();
  const [mode, setMode] = useState<"meter" | "time">("meter");
  const today = todayLocal();
  const [open, setOpen] = useState(false);
  const [toolError, setToolError] = useState<string | null>(null);
  // Mirrored in state only so the total below the readings can be recomputed
  // on every keystroke; the form itself is still the source of what is saved.
  const [readings, setReadings] = useState({
    startHourMeter: String(currentHourMeter),
    endHourMeter: "",
    startTime: "",
    stopTime: "",
    breakMinutes: "0",
  });
  const totalHours = workTotalHours({ mode, ...readings });
  const onReading = (field: keyof typeof readings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setReadings((prev) => ({ ...prev, [field]: e.target.value }));
  const { error, pending, run } = useApiForm(async (body: Record<string, unknown>) => {
    await apiFetch(`/api/excavators/${excavatorId}/daily-logs`, { method: "POST", body: JSON.stringify(body) });
  });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // The tool is compulsory on an admin entry too: Site Analysis splits hours
    // into Bucket / Brekar by this value, and an entry without one lands in
    // "Other / not specified", where it is counted but cannot be priced.
    if (!fd.get("attachment")) {
      setToolError(TOOL_REQUIRED_MESSAGE);
      return;
    }
    const ok = await run({
      workSessionId,
      date: fd.get("date"),
      startHourMeter: fd.get("startHourMeter") || undefined,
      endHourMeter: fd.get("endHourMeter") || undefined,
      startTime: fd.get("startTime") || undefined,
      stopTime: fd.get("stopTime") || undefined,
      breakMinutes: fd.get("breakMinutes") || undefined,
      operatorName: fd.get("operatorName") || undefined,
      dieselLiters: fd.get("dieselLiters") || undefined,
      notes: fd.get("notes") || undefined,
      attachment: fd.get("attachment"),
    });
    if (ok) {
      await mutate(`/api/excavators/${excavatorId}`);
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        data-agent-id="add-reading-trigger"
        render={<Button size="lg" variant="secondary" className="h-12 flex-1 text-base" />}
      >
        <Clock className="size-5" />
        Add Today&rsquo;s Work
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Today&rsquo;s Work</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="date" className="text-base">
              Date
            </Label>
            <Input id="date" data-agent-id="date" name="date" type="date" defaultValue={today} required className="h-12 text-base" />
          </div>

          <div className="flex gap-2 rounded-lg bg-muted p-1">
            <button
              type="button"
              aria-pressed={mode === "meter"}
              onClick={() => setMode("meter")}
              className={cn(
                "min-h-10 flex-1 rounded-md py-2 text-sm font-semibold",
                mode === "meter" ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              Hour Meter
            </button>
            <button
              type="button"
              aria-pressed={mode === "time"}
              onClick={() => setMode("time")}
              className={cn(
                "min-h-10 flex-1 rounded-md py-2 text-sm font-semibold",
                mode === "time" ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              Start / Stop Time
            </button>
          </div>

          {mode === "meter" ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="startHourMeter" className="text-base">
                  Start Meter
                </Label>
                <Input
                  id="startHourMeter"
                  // Distinct from Start Work's "startHourMeter" so the assistant
                  // can never type a reading's opening meter into the wrong form.
                  data-agent-id="reading-startHourMeter"
                  name="startHourMeter"
                  type="number"
                  step="0.1"
                  min="0"
                  value={readings.startHourMeter}
                  onChange={onReading("startHourMeter")}
                  className="h-12 text-base"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="endHourMeter" className="text-base">
                  End Meter
                </Label>
                <Input
                  id="endHourMeter"
                  data-agent-id="endHourMeter"
                  name="endHourMeter"
                  type="number"
                  step="0.1"
                  min="0"
                  value={readings.endHourMeter}
                  onChange={onReading("endHourMeter")}
                  className="h-12 text-base"
                />
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="startTime" className="text-base">
                    Start Time
                  </Label>
                  <Input
                    id="startTime"
                    name="startTime"
                    type="time"
                    value={readings.startTime}
                    onChange={onReading("startTime")}
                    className="h-12 text-base"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="stopTime" className="text-base">
                    Stop Time
                  </Label>
                  <Input
                    id="stopTime"
                    name="stopTime"
                    type="time"
                    value={readings.stopTime}
                    onChange={onReading("stopTime")}
                    className="h-12 text-base"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="breakMinutes" className="text-base">
                  Break (Minutes)
                </Label>
                <Input
                  id="breakMinutes"
                  name="breakMinutes"
                  type="number"
                  step="1"
                  min="0"
                  value={readings.breakMinutes}
                  onChange={onReading("breakMinutes")}
                  className="h-12 text-base"
                />
              </div>
            </>
          )}

          {/* Right under the readings: the hours the app worked out from them,
              so the total is never something the owner has to add up or save
              the entry to discover. */}
          <WorkTotalHours hours={totalHours} mode={mode} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="operatorName" className="text-base">
              Operator Name (Optional)
            </Label>
            <Input
              id="operatorName"
              name="operatorName"
              placeholder="Who ran the machine today"
              className="h-12 text-base"
            />
          </div>

          <AttachmentPicker
            name="attachment"
            label="Attachment / Tool Used"
            required
            error={toolError}
            onValueChange={() => setToolError(null)}
          />

          <div className="flex flex-col gap-2">
            <Label htmlFor="dieselLiters" className="text-base">
              Diesel Taken (L) (Optional)
            </Label>
            <Input id="dieselLiters" data-agent-id="dieselLiters" name="dieselLiters" type="number" step="0.1" min="0" className="h-12 text-base" />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="notes" className="text-base">
              Note (Optional)
            </Label>
            <Input id="notes" name="notes" className="h-12 text-base" />
          </div>

          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}

          <DialogFooter className="-mx-0 -mb-0 rounded-none border-0 bg-transparent p-0 sm:justify-stretch">
            <Button type="submit" data-agent-id="add-reading-submit" size="lg" className="h-12 w-full text-base" disabled={pending}>
              {pending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
