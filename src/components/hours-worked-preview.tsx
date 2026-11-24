import { calcHoursFromMeter, formatHours } from "@/lib/utils/hours";

/** Shown under an ending hour-meter box: the hours this reading adds up to,
 * recalculated as the reading is typed, so nobody works it out by hand. */
export function HoursWorkedPreview({
  startHourMeter,
  endHourMeter,
  label,
  invalidText,
}: {
  startHourMeter: number;
  /** The raw input value. */
  endHourMeter: string;
  label: string;
  /** Shown when the ending reading is not above the starting one. */
  invalidText: string;
}) {
  const end = endHourMeter.trim() === "" ? NaN : Number(endHourMeter);
  if (!Number.isFinite(end)) return null;
  const hours = calcHoursFromMeter(startHourMeter, end);
  const valid = hours > 0;
  return (
    <div
      aria-live="polite"
      className={
        valid
          ? "flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5"
          : "rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm font-medium text-destructive"
      }
    >
      {valid ? (
        <>
          <span className="text-sm text-muted-foreground">
            {label} ({formatHours(startHourMeter).replace(" hrs", "")} → {formatHours(end).replace(" hrs", "")})
          </span>
          <span className="text-lg font-bold">{formatHours(hours)}</span>
        </>
      ) : (
        invalidText
      )}
    </div>
  );
}
