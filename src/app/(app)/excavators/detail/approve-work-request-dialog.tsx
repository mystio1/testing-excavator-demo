"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { Check } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useApiForm } from "@/lib/use-api-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/native-select";
import { AttachmentPicker } from "@/components/attachment-picker";
import { TOOL_REQUIRED_MESSAGE } from "@/lib/attachments";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ApproveWorkRequestDialog({
  requestId,
  operatorName,
  startDate,
  endDate,
  startHourMeter,
  endHourMeter,
  attachment,
  siteName,
  dieselLiters,
  dieselDate,
  notes,
  customers,
  lastCustomerId,
  lastSiteName,
  onApproved,
}: {
  requestId: string;
  operatorName: string;
  /** The work dates the operator entered (the admin can correct them). */
  startDate: Date | string;
  endDate: Date | string | null;
  startHourMeter: number;
  endHourMeter: number;
  attachment: string | null;
  siteName: string | null;
  dieselLiters: number | null;
  dieselDate: Date | null;
  notes: string | null;
  customers: { id: string; name: string; companyName: string | null }[];
  /** Customer id from the operator's most recent approved session — pre-fills the picker. */
  lastCustomerId?: string | null;
  /** Site name from the operator's most recent approved session — used to detect a site change. */
  lastSiteName?: string | null;
  /** Called right before the dialog closes on a successful approval. */
  onApproved?: () => void;
}) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [addingCustomer, setAddingCustomer] = useState(customers.length === 0);
  const [toolError, setToolError] = useState<string | null>(null);
  const [currentSiteName, setCurrentSiteName] = useState(siteName ?? "");
  // Show site-change prompt when the admin edits the site to something different
  // from the operator's last job — offer to keep the previous customer.
  const siteChanged =
    lastSiteName != null &&
    currentSiteName.trim() !== "" &&
    currentSiteName.trim().toLowerCase() !== lastSiteName.trim().toLowerCase();
  const defaultCustomerId = lastCustomerId ?? "";
  const { error, pending, run } = useApiForm(async (body: Record<string, unknown>) => {
    await apiFetch(`/api/work-requests/${requestId}/approve`, { method: "POST", body: JSON.stringify(body) });
  });

  const dieselDateValue = dieselDate ? new Date(dieselDate).toISOString().slice(0, 10) : "";
  // Work dates are stored as the UTC midnight of the chosen day.
  const startDateValue = new Date(startDate).toISOString().slice(0, 10);
  const endDateValue = endDate ? new Date(endDate).toISOString().slice(0, 10) : startDateValue;

  /** Approves on the first press. The litres left in the tank are asked for
   * once, on the form; a blank one is accepted without a second question. */
  async function doSubmit(fd: FormData) {
    if (!fd.get("attachment")) {
      setToolError(TOOL_REQUIRED_MESSAGE);
      return;
    }
    const diesel = fd.get("dieselLiters");
    const remaining = fd.get("remainingDieselLiters");
    const ok = await run({
      customerId: fd.get("customerId") || undefined,
      newCustomerName: fd.get("newCustomerName") || undefined,
      newCustomerMobile: fd.get("newCustomerMobile") || undefined,
      siteName: fd.get("siteName"),
      startHourMeter: Number(fd.get("startHourMeter")),
      endHourMeter: Number(fd.get("endHourMeter")),
      startDate: fd.get("startDate") || undefined,
      endDate: fd.get("endDate") || undefined,
      attachment: fd.get("attachment"),
      dieselLiters: diesel || undefined,
      remainingDieselLiters: remaining || undefined,
      dieselDate: fd.get("dieselDate") || undefined,
      notes: fd.get("notes") || undefined,
    });
    if (ok) {
      onApproved?.();
      await mutate((key) => typeof key === "string" && (key.startsWith("/api/excavators") || key === "/api/approvals"));
      setOpen(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await doSubmit(new FormData(e.currentTarget));
  }

  function handleOpenChange(v: boolean) {
    setOpen(v);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" className="bg-working text-working-foreground hover:bg-working/90" />}>
        <Check className="size-4" />
        Approve
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Approve Job</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="rounded-lg border border-dashed p-3 text-sm">
            <span className="text-muted-foreground">Operator: </span>
            <span className="font-semibold">{operatorName}</span>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={addingCustomer ? "approve-newCustomerName" : "approve-customerId"} className="text-base">
              Customer
            </Label>
            {siteChanged && (
              <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                Site changed from <strong>{lastSiteName}</strong> to <strong>{currentSiteName}</strong>. Should the customer change too?
              </div>
            )}
            {!addingCustomer ? (
              <>
                <NativeSelect id="approve-customerId" name="customerId" defaultValue={defaultCustomerId} className="h-12 text-base">
                  <option value="" disabled>
                    Select customer
                  </option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.companyName ? ` (${c.companyName})` : ""}
                    </option>
                  ))}
                </NativeSelect>
                {customers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAddingCustomer(true)}
                    className="self-start text-sm font-semibold text-primary-text"
                  >
                    + Add New Customer
                  </button>
                )}
              </>
            ) : (
              <>
                <Input id="approve-newCustomerName" name="newCustomerName" placeholder="Customer name" required className="h-12 text-base" />
                <Input name="newCustomerMobile" aria-label="Customer mobile number (optional)" placeholder="Mobile number (optional)" className="h-12 text-base" />
                {customers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAddingCustomer(false)}
                    className="self-start text-sm font-semibold text-muted-foreground"
                  >
                    Use existing customer instead
                  </button>
                )}
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`approve-startHourMeter-${requestId}`} className="text-base">
                Starting Reading
              </Label>
              <Input
                key={startHourMeter}
                id={`approve-startHourMeter-${requestId}`}
                name="startHourMeter"
                type="number"
                step="0.1"
                min="0"
                defaultValue={startHourMeter}
                required
                className="h-12 text-base"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`approve-endHourMeter-${requestId}`} className="text-base">
                Ending Reading
              </Label>
              <Input
                key={endHourMeter}
                id={`approve-endHourMeter-${requestId}`}
                name="endHourMeter"
                type="number"
                step="0.1"
                min="0"
                defaultValue={endHourMeter}
                required
                className="h-12 text-base"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`approve-startDate-${requestId}`} className="text-base">
                Work Date
              </Label>
              <Input
                key={startDateValue}
                id={`approve-startDate-${requestId}`}
                name="startDate"
                type="date"
                defaultValue={startDateValue}
                required
                className="h-12 text-base"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`approve-endDate-${requestId}`} className="text-base">
                Work End Date
              </Label>
              <Input
                key={endDateValue}
                id={`approve-endDate-${requestId}`}
                name="endDate"
                type="date"
                defaultValue={endDateValue}
                className="h-12 text-base"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`approve-siteName-${requestId}`} className="text-base">
              Site
            </Label>
            <Input
              key={siteName}
              id={`approve-siteName-${requestId}`}
              name="siteName"
              placeholder="e.g. Wagholi"
              defaultValue={siteName ?? ""}
              required
              className="h-12 text-base"
              onChange={(e) => setCurrentSiteName(e.target.value)}
            />
          </div>

          <AttachmentPicker
            key={attachment ?? "none"}
            name="attachment"
            defaultValue={attachment}
            label="Attachment / Tool Used"
            required
            error={toolError}
            onValueChange={() => setToolError(null)}
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`approve-dieselLiters-${requestId}`} className="text-base">
                Diesel Received (L)
              </Label>
              <Input
                key={dieselLiters}
                id={`approve-dieselLiters-${requestId}`}
                name="dieselLiters"
                type="number"
                step="0.1"
                min="0"
                defaultValue={dieselLiters ?? undefined}
                className="h-12 text-base"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`approve-remainingDiesel-${requestId}`} className="text-base">
                Diesel left in tank (L)
              </Label>
              <Input
                id={`approve-remainingDiesel-${requestId}`}
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
            Litres still in the tank at the end of the work. Leave blank if it wasn&rsquo;t recorded — it only
            makes the consumption rate exact.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`approve-dieselDate-${requestId}`} className="text-base">
                Diesel Date
              </Label>
              <Input
                key={dieselDateValue}
                id={`approve-dieselDate-${requestId}`}
                name="dieselDate"
                type="date"
                defaultValue={dieselDateValue}
                className="h-12 text-base"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`approve-notes-${requestId}`} className="text-base">
              Note (Optional)
            </Label>
            <Textarea
              key={notes}
              id={`approve-notes-${requestId}`}
              name="notes"
              defaultValue={notes ?? ""}
              className="min-h-20"
            />
          </div>

          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}

          <DialogFooter className="-mx-0 -mb-0 rounded-none border-0 bg-transparent p-0 sm:justify-stretch">
            <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={pending}>
              {pending ? "Approving..." : "Approve & Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
