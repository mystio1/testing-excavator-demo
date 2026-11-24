"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { Square } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useApiForm } from "@/lib/use-api-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AttachmentPicker } from "@/components/attachment-picker";
import { HoursWorkedPreview } from "@/components/hours-worked-preview";
import { todayLocal } from "@/lib/utils/dates";
import { ot, otMsg, type OperatorLang } from "@/lib/i18n/operator";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function EndWorkDialog({
  requestId,
  currentHourMeter,
  startHourMeter,
  startDate,
  endDate,
  attachment,
  triggerLabel,
  lang,
}: {
  requestId: string;
  currentHourMeter: number;
  /** The reading the job started at — total hours are counted from it. */
  startHourMeter: number;
  /** The work date the operator entered when starting. */
  startDate: Date;
  /** A previously submitted work end date (resubmission after a reject). */
  endDate?: Date | null;
  /** The tool already recorded for this job, if any. */
  attachment?: string | null;
  triggerLabel?: string;
  lang: OperatorLang;
}) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [toolError, setToolError] = useState<string | null>(null);
  const [endReading, setEndReading] = useState(String(currentHourMeter));
  const today = todayLocal();
  const startDateValue = new Date(startDate).toISOString().slice(0, 10);
  const endDateValue = endDate ? new Date(endDate).toISOString().slice(0, 10) : startDateValue;
  const { error, pending, run } = useApiForm(async (body: Record<string, unknown>) => {
    await apiFetch("/api/operator/work/end", { method: "POST", body: JSON.stringify(body) });
  });
  const t = (key: string) => ot(lang, key);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // A job always needs a tool; one chosen at start is pre-selected here.
    if (!fd.get("attachment")) {
      setToolError(t("tool.required"));
      return;
    }
    const ok = await run({
      requestId,
      endHourMeter: fd.get("endHourMeter"),
      endDate: fd.get("endDate") || undefined,
      attachment: fd.get("attachment"),
    });
    if (ok) {
      await mutate("/api/operator/home");
      setOpen(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setEndReading(String(currentHourMeter));
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button
            size="lg"
            variant="outline"
            className="h-12 w-full border-destructive text-destructive text-base hover:bg-destructive/10"
          />
        }
      >
        <Square className="size-5" />
        {triggerLabel ?? t("endWork.trigger")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("endWork.title")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`endHourMeter-${requestId}`} className="text-base">
              {t("endWork.endingHourMeter")}
            </Label>
            <Input
              key={currentHourMeter}
              id={`endHourMeter-${requestId}`}
              name="endHourMeter"
              type="number"
              step="0.1"
              min="0"
              value={endReading}
              onChange={(e) => setEndReading(e.target.value)}
              required
              className="h-12 text-base"
              autoFocus
            />
            <HoursWorkedPreview
              startHourMeter={startHourMeter}
              endHourMeter={endReading}
              label={t("endWork.totalHours")}
              invalidText={t("endWork.endBelowStart")}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`endDate-${requestId}`} className="text-base">
              {t("endWork.workEndDate")}
            </Label>
            <Input
              key={endDateValue}
              id={`endDate-${requestId}`}
              name="endDate"
              type="date"
              defaultValue={endDateValue}
              min={startDateValue}
              max={today}
              className="h-12 text-base"
            />
            <p className="text-xs text-muted-foreground">{t("endWork.workEndDateHelp")}</p>
          </div>

          <AttachmentPicker
            key={attachment ?? "none"}
            name="attachment"
            defaultValue={attachment}
            label={t("startWork.attachment")}
            required
            error={toolError}
            onValueChange={() => setToolError(null)}
            optionLabels={{ Bucket: t("tool.bucket"), Breaker: t("tool.breaker"), Chaining: t("tool.chaining") }}
          />

          <p className="text-xs text-muted-foreground">{t("endWork.help")}</p>

          {error && <p role="alert" className="text-sm font-medium text-destructive">{otMsg(lang, error)}</p>}

          <DialogFooter className="-mx-0 -mb-0 rounded-none border-0 bg-transparent p-0 sm:justify-stretch">
            <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={pending}>
              {pending ? t("endWork.submitting") : t("endWork.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
