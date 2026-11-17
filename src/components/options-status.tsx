"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * What a picker shows in place of its list when there is no list yet.
 *
 * The three cases it keeps apart are the whole point: "still loading", "the
 * request failed, here is a Retry" and "the business really has none of
 * these". Conflating the first two with the third is what told an owner with a
 * full customer list that they had no customers, and left reloading the app as
 * the only remedy.
 */
export function OptionsStatus({
  isLoading,
  error,
  retry,
  noun,
  emptyMessage,
}: {
  isLoading: boolean;
  error: Error | undefined;
  retry: () => void;
  /** Plural, lowercase: "customers", "operators". */
  noun: string;
  /** Shown only when the server actually answered with an empty list. */
  emptyMessage?: string;
}) {
  if (isLoading) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading {noun}…
      </p>
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
        <p className="text-sm font-medium text-destructive">
          Could not load your {noun}. Check the connection and try again — nothing has been lost.
        </p>
        <Button type="button" size="sm" variant="outline" className="self-start" onClick={retry}>
          <RefreshCw className="size-4" />
          Retry
        </Button>
      </div>
    );
  }

  return emptyMessage ? <p className="text-sm text-muted-foreground">{emptyMessage}</p> : null;
}
