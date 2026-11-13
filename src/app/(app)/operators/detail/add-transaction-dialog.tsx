"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { IndianRupee } from "lucide-react";
import { ApiError, apiFetch, newIdempotencyKey } from "@/lib/api-client";
import { useApiForm } from "@/lib/use-api-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TransactionFormFields } from "./transaction-form-fields";

import { todayLocal } from "@/lib/utils/dates";
export function AddTransactionDialog({
  operatorId,
  categories,
  suggestedAmount,
}: {
  operatorId: string;
  categories: { id: string; name: string }[];
  suggestedAmount?: number | null;
}) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [quickAmount, setQuickAmount] = useState<number | null>(null);
  const today = todayLocal();
  const defaultCategoryId = categories.find((c) => c.name === "Salary Advance")?.id ?? "";

  // One key per logical submission: a retry after a lost response replays the
  // first result instead of recording the payment twice. A fresh key is made
  // when the dialog opens and after every success.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const { error, pending, run } = useApiForm(async (body: Record<string, unknown>) => {
    try {
      await apiFetch(`/api/operators/${operatorId}/transactions`, {
        method: "POST",
        body: JSON.stringify(body),
        idempotencyKey,
      });
    } catch (err) {
      // The key was already spent on a different amount/date — the next attempt is a new submission.
      if (err instanceof ApiError && err.code === "IDEMPOTENCY_KEY_REUSED") setIdempotencyKey(newIdempotencyKey());
      throw err;
    }
  });

  function onOpenChange(next: boolean) {
    if (next) {
      setIdempotencyKey(newIdempotencyKey());
      setQuickAmount(null);
    }
    setOpen(next);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const ok = await run({
      categoryId: fd.get("categoryId") || undefined,
      newCategoryName: fd.get("newCategoryName") || undefined,
      amount: Number(fd.get("amount")),
      date: fd.get("date"),
      notes: fd.get("notes") || undefined,
      deductFromSalary: fd.get("deductFromSalary") === "on",
      businessEffect: fd.get("businessEffect"),
    });
    if (ok) {
      setIdempotencyKey(newIdempotencyKey());
      await mutate((key) => typeof key === "string" && key.startsWith("/api/operators/detail"));
      setOpen(false);
    }
  }

  const formattedSuggestion = suggestedAmount != null
    ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(suggestedAmount)
    : null;

  return (
    <div className="flex flex-col gap-2">
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger data-agent-id="add-transaction-trigger" render={<Button size="lg" className="h-11" />}>
          <IndianRupee className="size-4" />
          Add Money Transaction
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Money Transaction</DialogTitle>
          </DialogHeader>
          <form key={quickAmount ?? "default"} onSubmit={onSubmit} className="flex flex-col gap-4">
            <TransactionFormFields
              categories={categories}
              defaultCategoryId={defaultCategoryId}
              defaultDate={today}
              defaultAmount={quickAmount ?? undefined}
            />

            {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}

            <DialogFooter className="-mx-0 -mb-0 rounded-none border-0 bg-transparent p-0 sm:justify-stretch">
              <Button type="submit" data-agent-id="add-transaction-submit" size="lg" className="h-12 w-full text-base" disabled={pending}>
                {pending ? "Saving..." : "Save Transaction"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {formattedSuggestion && (
        <button
          type="button"
          onClick={() => {
            setQuickAmount(suggestedAmount!);
            onOpenChange(true);
          }}
          className="flex items-center gap-1.5 self-start rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
        >
          <IndianRupee className="size-3.5" />
          Quick add ₹{formattedSuggestion}
        </button>
      )}
    </div>
  );
}
