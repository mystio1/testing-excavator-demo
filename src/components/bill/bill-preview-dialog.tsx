"use client";

import useSWR from "swr";
import { Pencil } from "lucide-react";
import { swrFetcher } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BillLetterhead } from "@/lib/services/bills";
import { BillPreview, type BillPreviewData } from "./bill-preview";

type PreviewContext = {
  letterhead: BillLetterhead;
  customer: { name: string; address: string | null; mobile: string | null; gstNumber: string | null } | null;
};

/** The bill exactly as it will print, built from the form BEFORE it is saved.
 * "Generate & Save" submits the form behind it (same validation, same request);
 * "Edit" just closes the preview. */
export function BillPreviewDialog({
  open,
  onOpenChange,
  customerId,
  bankAccountId,
  bill,
  onGenerate,
  pending,
  blocker,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  bankAccountId: string;
  /** Everything but what the server supplies (letterhead, customer details). */
  bill: Omit<BillPreviewData, "letterhead" | "customerName" | "customerAddress" | "customerMobile">;
  onGenerate: () => void;
  pending: boolean;
  blocker: string | null;
}) {
  const query = new URLSearchParams();
  if (customerId) query.set("customerId", customerId);
  if (bankAccountId) query.set("bankAccountId", bankAccountId);
  const { data, error } = useSWR<PreviewContext>(open ? `/api/bills/preview-context?${query}` : null, swrFetcher);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] gap-3 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Bill Preview</DialogTitle>
        </DialogHeader>
        <p className="-mt-1 text-xs text-muted-foreground">
          Not saved yet. {bill.billNumber ? "" : "The bill number is given when you generate it."}
        </p>

        <div className="overflow-x-auto rounded-lg border">
          {data ? (
            <div className="min-w-[640px]">
              <BillPreview
                bill={{
                  ...bill,
                  letterhead: data.letterhead,
                  customerName: data.customer?.name ?? "",
                  customerAddress: data.customer?.address,
                  customerMobile: data.customer?.mobile,
                }}
              />
            </div>
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {error ? "Could not load the preview." : "Loading preview…"}
            </p>
          )}
        </div>

        {blocker && <p className="text-center text-xs font-medium text-muted-foreground">{blocker}</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" size="lg" className="h-12 text-base" onClick={() => onOpenChange(false)}>
            <Pencil className="size-4" />
            Edit
          </Button>
          <Button
            type="button"
            size="lg"
            className="h-12 text-base"
            disabled={pending || blocker !== null}
            onClick={onGenerate}
          >
            {pending ? "Generating..." : "Generate & Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
