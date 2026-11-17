"use client";

import { calcHoursFromClock, calcHoursFromMeter, formatHours } from "@/lib/utils/hours";

/**
 * The running total of a work entry, shown under the reading inputs while they
 * are being filled in.
 *
 * The owner must never be asked to work the hours out by hand, and must never
 * have to save the entry to find out what the app made of it. It deliberately
 * calls the SAME two functions the server uses to derive `hoursWorked`
 * (calcHoursFromMeter / calcHoursFromClock), so the figure on screen is the
 * figure that will be stored — not a second formula that could drift from it.
 *
 * Nothing here asks a question or blocks a save: an incomplete pair of
 * readings simply shows a dash.
 */

/** Hours for a work entry, or null when the inputs can't yet produce one.
 * `""` / undefined mean "not filled in yet", which is not an error. */
export function workTotalHours(input: {
  mode: "meter" | "time";
  startHourMeter?: string | number | null;
  endHourMeter?: string | number | null;
  startTime?: string | null;
  stopTime?: string | null;
  breakMinutes?: string | number | null;
}): number | null {
  if (input.mode === "meter") {
    const start = toNum(input.startHourMeter);
    const end = toNum(input.endHourMeter);
    if (start == null || end == null) return null;
    const hours = calcHoursFromMeter(start, end);
    return hours > 0 ? hours : null;
  }
  const { startTime, stopTime } = input;
  if (!startTime || !stopTime) return null;
  const breakMinutes = toNum(input.breakMinutes) ?? 0;
  const hours = calcHoursFromClock(startTime, stopTime, breakMinutes);
  return hours > 0 ? hours : null;
}

/**
 * The same figure, read straight off a form's own fields.
 *
 * Forms whose inputs are uncontrolled (the edit dialogs, which fill them from
 * the stored record with `defaultValue`) get the running total by handing this
 * their <form> on change, instead of being rewritten to mirror every field in
 * React state.
 */
export function formTotalHours(form: HTMLFormElement, mode: "meter" | "time"): number | null {
  const fd = new FormData(form);
  const field = (name: string) => {
    const v = fd.get(name);
    return typeof v === "string" ? v : "";
  };
  return workTotalHours({
    mode,
    startHourMeter: field("startHourMeter"),
    endHourMeter: field("endHourMeter"),
    startTime: field("startTime"),
    stopTime: field("stopTime"),
    breakMinutes: field("breakMinutes"),
  });
}

function toNum(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function WorkTotalHours({
  hours,
  mode,
  label = "Total Today's Work",
}: {
  hours: number | null;
  /** Spells out which readings produced the number, so it is obvious the app
   * did the arithmetic rather than inventing a figure. */
  mode: "meter" | "time";
  label?: string;
}) {
  return (
    <div
      data-agent-id="work-total-hours"
      aria-live="polite"
      className="flex items-baseline justify-between gap-3 rounded-lg border border-dashed bg-muted/40 px-3 py-2"
    >
      <span className="text-sm font-semibold text-muted-foreground">{label}</span>
      <span className="text-right">
        <span className="text-lg font-bold tabular-nums">{hours == null ? "—" : formatHours(hours)}</span>
        <span className="block text-xs text-muted-foreground">
          {mode === "meter" ? "End meter − start meter" : "Stop time − start time − break"}
        </span>
      </span>
    </div>
  );
}
