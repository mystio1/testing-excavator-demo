"use client";

import { useId, useState } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ATTACHMENT_VALUES, type AttachmentValue } from "@/lib/attachments";

// Re-exported for existing importers; the canonical list lives in
// "@/lib/attachments" so server code can use it as a value too.
export { ATTACHMENT_VALUES };

export function AttachmentPicker({
  name,
  defaultValue,
  label,
  optionLabels,
  required,
  error,
  onValueChange,
}: {
  name: string;
  defaultValue?: string | null;
  label: string;
  /** Displayed label per canonical value — defaults to the English value itself. */
  optionLabels?: Partial<Record<AttachmentValue, string>>;
  /** The hidden input can't use native `required`, so this marks the group
   * (aria-required) and the caller blocks submit and passes `error`. */
  required?: boolean;
  /** Visible error shown under the buttons (also announced to screen readers). */
  error?: string | null;
  /** Fired when the selection changes, so the caller can clear its error. */
  onValueChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const labelId = useId();
  const errorId = useId();

  function select(opt: string) {
    // A required tool can't be un-picked back to nothing; an optional one can.
    const next = value === opt && !required ? "" : opt;
    setValue(next);
    onValueChange?.(next);
  }

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-required={required || undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
      className="flex flex-col gap-2"
    >
      <Label id={labelId} className="text-base">
        {label}
      </Label>
      <input type="hidden" name={name} value={value} />
      <div className={cn("grid grid-cols-3 gap-2", error && "rounded-lg ring-2 ring-destructive/60 ring-offset-2 ring-offset-background")}>
        {ATTACHMENT_VALUES.map((opt) => (
          <button
            key={opt}
            type="button"
            aria-pressed={value === opt}
            // The assistant chooses a tool with a `pickFromList` step: it
            // matches the label and clicks the matching button. Annotated
            // literally (not through a prop) because tests/agent/manifest.test.ts
            // reads these ids off disk — a computed attribute would make the
            // registry's promise that this control exists unverifiable.
            //
            // The label is the canonical English value rather than the
            // displayed one, so "breaker" matches the same way whichever
            // language the portal is in.
            data-agent-id="attachment"
            data-agent-label={opt}
            onClick={() => select(opt)}
            className={cn(
              "h-11 rounded-lg border text-sm font-semibold transition-colors",
              value === opt
                ? "border-primary bg-primary text-primary-foreground"
                : "border-control bg-muted text-muted-foreground",
            )}
          >
            {optionLabels?.[opt] ?? opt}
          </button>
        ))}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
