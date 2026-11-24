"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/currency";
import { FormAlert } from "./form-parts";
import { useIsDesktop, useKeyboardOpen } from "./use-viewport";

/** Error, conflict recovery and the save button. On a phone the save button
 * lives in a bar fixed above the bottom navigation, with the running total
 * beside it, so the total and "Generate Bill" are always one tap away. */
export function SubmitBar({
  mode,
  pending,
  blocker,
  error,
  conflict = false,
  onReloadLatest,
  total,
  idleLabel,
  pendingLabel = "Saving...",
  onPreview,
}: {
  mode: "create" | "edit";
  pending: boolean;
  /** Why saving is not possible yet (shown next to the button), or null. */
  blocker: string | null;
  error: string | null;
  conflict?: boolean;
  onReloadLatest?: () => void;
  total: number;
  /** Button text; defaults to "Save Changes" (edit) / "Generate Bill" (create). */
  idleLabel?: string;
  pendingLabel?: string;
  /** When given, a "Preview Bill" button sits beside the save button. */
  onPreview?: () => void;
}) {
  const isDesktop = useIsDesktop();
  const keyboardOpen = useKeyboardOpen();
  const hintId = useId();
  const statusRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);

  // The bar is fixed, so the form reserves its height at the end; otherwise it
  // would sit on top of the last field.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const observer = new ResizeObserver(() => setBarHeight(bar.offsetHeight));
    observer.observe(bar);
    return () => observer.disconnect();
  }, [isDesktop]);

  // A failed save may be reported far from where the user is looking.
  useEffect(() => {
    if (error) statusRef.current?.scrollIntoView({ block: "center" });
  }, [error]);

  const label = pending ? pendingLabel : (idleLabel ?? (mode === "edit" ? "Save Changes" : "Generate Bill"));

  return (
    <>
      <div ref={statusRef} className="flex flex-col gap-3 empty:hidden">
        {error && <FormAlert>{error}</FormAlert>}
        {conflict && onReloadLatest && (
          <Button type="button" variant="outline" className="h-11" onClick={onReloadLatest}>
            Reload latest version
          </Button>
        )}
      </div>

      {isDesktop ? (
        <>
          <div className={cn("grid gap-3", onPreview && "grid-cols-2")}>
            {onPreview && (
              <Button type="button" variant="outline" size="lg" className="h-12 text-base" disabled={pending} onClick={onPreview}>
                <Eye className="size-4" />
                Preview Bill
              </Button>
            )}
            <Button
              type="submit"
              size="lg"
              className="h-12 text-base"
              disabled={pending || blocker !== null}
              aria-describedby={blocker ? hintId : undefined}
            >
              {label}
            </Button>
          </div>
          {blocker && (
            <p id={hintId} className="-mt-2 text-center text-xs text-muted-foreground">
              {blocker}
            </p>
          )}
        </>
      ) : (
        <>
          <div aria-hidden style={{ height: barHeight + 8 }} />
          <div
            ref={barRef}
            // visibility (not display) while the keyboard is up: the bar keeps its
            // size, so the reserved space above does not jump while typing.
            className={cn(
              "fixed inset-x-0 z-30 border-t bg-card px-4 pt-2 pb-2 shadow-[0_-6px_16px_-10px_rgba(15,23,42,0.35)]",
              "bottom-[calc(3.85rem+env(safe-area-inset-bottom))]",
              keyboardOpen && "invisible",
            )}
          >
            {blocker && (
              <p id={hintId} className="mb-1 text-xs font-medium text-muted-foreground">
                {blocker}
              </p>
            )}
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-none text-muted-foreground">Total</p>
                <p className="truncate text-lg leading-tight font-bold tabular-nums">{formatCurrency(total)}</p>
              </div>
              {onPreview && (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="h-12 shrink-0 px-3 text-base"
                  disabled={pending}
                  onClick={onPreview}
                  aria-label="Preview Bill"
                >
                  <Eye className="size-4" />
                  Preview
                </Button>
              )}
              <Button
                type="submit"
                size="lg"
                className="h-12 shrink-0 px-5 text-base"
                disabled={pending || blocker !== null}
                aria-describedby={blocker ? hintId : undefined}
              >
                {label}
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
