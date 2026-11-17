"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { Clock } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useApiForm } from "@/lib/use-api-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AttachmentPicker } from "@/components/attachment-picker";
import { WorkTotalHours, workTotalHours } from "@/components/work-total-hours";
import { cn } from "@/lib/utils";
import { ot, otMsg, type OperatorLang } from "@/lib/i18n/operator";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { todayLocal } from "@/lib/utils/dates";

export function SubmitReadingDialog({
  workSessionId,
  currentHourMeter,
  lang,
}: {
  workSessionId: string;
  currentHourMeter: number;
  lang: OperatorLang;
}) {
  const { mutate } = useSWRConfig();
  const [mode, setMode] = useState<"meter" | "time">("meter");
  const today = todayLocal();
  const [open, setOpen] = useState(false);
  const [toolError, setToolError] = useState<string | null>(null);
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
    await apiFetch("/api/operator/daily-log", { method: "POST", body: JSON.stringify(body) });
  });
  const t = (key: string) => ot(lang, key);

  /** Saves straight away. Diesel left in the tank is asked for once, on the
   * form, and left blank if the operator does not have it — the entry is NOT
   * interrupted to ask again (Site Analysis falls back to the simple
   * diesel-per-hour average when a closing balance is missing). */
  async function submit(fd: FormData) {
    if (!fd.get("attachment")) {
      setToolError(t("tool.required"));
      return;
    }
    const diesel = fd.get("dieselLiters");
    const remaining = fd.get("remainingDieselLiters");
    const ok = await run({
      workSessionId,
      date: fd.get("date"),
      startHourMeter: fd.get("startHourMeter") || undefined,
      endHourMeter: fd.get("endHourMeter") || undefined,
      startTime: fd.get("startTime") || undefined,
      stopTime: fd.get("stopTime") || undefined,
      breakMinutes: fd.get("breakMinutes") || undefined,
      dieselLiters: diesel || undefined,
      remainingDieselLiters: remaining || undefined,
      notes: fd.get("notes") || undefined,
      attachment: fd.get("attachment"),
    });
    if (ok) {
      await mutate("/api/operator/home");
      setOpen(false);
    }
  }

  function handleOpen(v: boolean) {
    setOpen(v);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await submit(new FormData(e.currentTarget));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={<Button size="lg" className="h-12 w-full text-base" />}>
        <Clock className="size-5" />
        {t("submitReading.trigger")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("submitReading.title")}</DialogTitle>
        </DialogHeader>
        <form id="submit-reading-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="date" className="text-base">
              {t("submitReading.date")}
            </Label>
            <Input id="date" name="date" type="date" defaultValue={today} required className="h-12 text-base" />
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
              {t("submitReading.hourMeter")}
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
              {t("submitReading.startStopTime")}
            </button>
          </div>

          {mode === "meter" ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="startHourMeter" className="text-base">
                  {t("submitReading.startMeter")}
                </Label>
                <Input
                  id="startHourMeter"
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
                  {t("submitReading.endMeter")}
                </Label>
                <Input
                  id="endHourMeter"
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
                    {t("submitReading.startTime")}
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
                    {t("submitReading.stopTime")}
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
                  {t("submitReading.breakMinutes")}
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

          {/* The day's total, worked out from the readings above as they are
              typed — the operator is never asked to do the arithmetic. */}
          <WorkTotalHours hours={totalHours} mode={mode} label={t("submitReading.totalToday")} />

          <AttachmentPicker
            name="attachment"
            label={t("startWork.attachment")}
            required
            error={toolError}
            onValueChange={() => setToolError(null)}
            optionLabels={{ Bucket: t("tool.bucket"), Breaker: t("tool.breaker"), Chaining: t("tool.chaining") }}
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="dieselLiters" className="text-base">
                {t("startWork.dieselReceived")}
              </Label>
              <Input
                id="dieselLiters"
                name="dieselLiters"
                type="number"
                step="0.1"
                min="0"
                className="h-12 text-base"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="remainingDieselLiters" className="text-base">
                Diesel left in tank (L)
              </Label>
              <Input
                id="remainingDieselLiters"
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
            Diesel still in the tank at the end of today&apos;s work. Leave it blank if you don&apos;t have the
            reading — it only makes the consumption rate exact.
          </p>

          <div className="flex flex-col gap-2">
            <Label htmlFor="notes" className="text-base">
              {t("startWork.note")}
            </Label>
            <Textarea id="notes" name="notes" placeholder={t("startWork.notePlaceholder")} className="min-h-20" />
          </div>

          {error && <p role="alert" className="text-sm font-medium text-destructive">{otMsg(lang, error)}</p>}

          <DialogFooter className="-mx-0 -mb-0 rounded-none border-0 bg-transparent p-0 sm:justify-stretch">
            <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={pending}>
              {pending ? t("submitReading.submitting") : t("submitReading.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
