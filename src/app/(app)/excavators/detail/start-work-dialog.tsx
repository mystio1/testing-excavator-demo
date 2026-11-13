"use client";

import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { Play, Plus } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useApiForm } from "@/lib/use-api-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/native-select";
import { AttachmentPicker } from "@/components/attachment-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { todayLocal } from "@/lib/utils/dates";
type CustomerOption = { id: string; name: string; companyName: string | null };
type SiteOption = { id: string; name: string; customerId: string | null };

/** Same rule findOrCreateSite uses server-side, so the site the form resolves
 * is the one the job will actually be filed under. */
const sameSite = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function StartWorkDialog({
  excavatorId,
  currentHourMeter,
  currentOperatorName,
  defaultSiteName,
  customers: initialCustomers,
  sites,
}: {
  excavatorId: string;
  currentHourMeter: number;
  currentOperatorName: string | null;
  defaultSiteName: string | null;
  customers: CustomerOption[];
  sites: SiteOption[];
}) {
  const { mutate } = useSWRConfig();
  const today = todayLocal();
  const [open, setOpen] = useState(false);

  /**
   * Derived, not copied.
   *
   * `useState(initialCustomers)` captured the prop on the first render only,
   * and this list arrives from SWR a moment after the page does. Open the
   * dialog before that fetch lands and it was stuck on an empty list for good:
   * "Add a customer below to get started" with Save disabled, for an owner who
   * has customers. Closing and reopening fixed it, which is why it looked like
   * a flicker rather than a bug.
   *
   * `added` holds only what was created inline here, so the newly added
   * customer is selectable before the refetch includes it.
   */
  const [added, setAdded] = useState<CustomerOption[]>([]);
  const customers = useMemo(() => {
    const known = new Set(initialCustomers.map((c) => c.id));
    return [...initialCustomers, ...added.filter((c) => !known.has(c.id))];
  }, [initialCustomers, added]);
  const [siteName, setSiteName] = useState(defaultSiteName ?? "");

  // A site already belongs to a customer, so asking for the customer again is
  // asking for something the app knows. Typing a different site re-answers it;
  // a site with no customer yet (or a brand new one) still has to be asked.
  const siteCustomerId = sites.find((s) => sameSite(s.name, siteName))?.customerId ?? "";
  const [customerOverride, setCustomerOverride] = useState<string | null>(null);
  const customerId = customerOverride ?? siteCustomerId;
  const customerFromSite = customerOverride === null && siteCustomerId !== "";

  const { error, pending, run } = useApiForm(async (body: Record<string, unknown>) => {
    await apiFetch(`/api/excavators/${excavatorId}/start-work`, { method: "POST", body: JSON.stringify(body) });
  });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const ok = await run({
      customerId,
      siteName: fd.get("siteName"),
      startDate: fd.get("startDate"),
      startHourMeter: Number(fd.get("startHourMeter")),
      attachment: fd.get("attachment") || undefined,
    });
    if (ok) {
      await mutate(`/api/excavators/${excavatorId}`);
      setOpen(false);
    }
  }

  function onOpenChange(next: boolean) {
    if (next) {
      setSiteName(defaultSiteName ?? "");
      setCustomerOverride(null);
    }
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        data-agent-id="start-work-trigger"
        render={<Button size="lg" className="h-12 flex-1 text-base" />}
      >
        <Play className="size-5" />
        Start New Work
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start New Work</DialogTitle>
        </DialogHeader>
        {!currentOperatorName ? (
          <p className="text-sm text-muted-foreground">
            No operator is assigned to this machine yet. Assign one from the card above before starting work.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <form id="start-work-form" onSubmit={onSubmit} className="contents">
              <div className="rounded-lg border border-dashed p-3 text-sm">
                <span className="text-muted-foreground">Operator: </span>
                <span className="font-semibold">{currentOperatorName}</span>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="customerId" className="text-base">
                  Customer
                </Label>
                {customers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Add a customer below to get started.</p>
                ) : (
                  <NativeSelect
                    id="customerId"
                  data-agent-id="customerId"
                    name="customerId"
                    required
                    value={customerId}
                    onChange={(e) => setCustomerOverride(e.target.value)}
                  >
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
                )}
                {customerFromSite && (
                  <p className="text-xs text-muted-foreground">
                    This site&rsquo;s customer — change it only if this job is for someone else.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="siteName" className="text-base">
                  Site
                </Label>
                <Input
                  id="siteName"
                  data-agent-id="siteName"
                  name="siteName"
                  placeholder="e.g. Wagholi"
                  value={siteName}
                  onChange={(e) => {
                    setSiteName(e.target.value);
                    // A new site answers the customer question afresh, so a
                    // choice made for the old one must not silently carry over.
                    setCustomerOverride(null);
                  }}
                  list="start-work-sites"
                  required
                  className="h-12 text-base"
                />
                <datalist id="start-work-sites">
                  {sites.map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
                </datalist>
                {defaultSiteName && (
                  <p className="text-xs text-muted-foreground">
                    Filled in from this machine&rsquo;s last known location — change it if that&rsquo;s not right
                    today.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="startDate" className="text-base">
                  Start Date
                </Label>
                <Input id="startDate" data-agent-id="startDate" name="startDate" type="date" defaultValue={today} required className="h-12 text-base" />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="startHourMeter" className="text-base">
                  Starting Hour Meter
                </Label>
                <Input
                  id="startHourMeter"
                  data-agent-id="startHourMeter"
                  name="startHourMeter"
                  type="number"
                  step="0.1"
                  min="0"
                  defaultValue={currentHourMeter}
                  required
                  className="h-12 text-base"
                />
              </div>

              <AttachmentPicker name="attachment" label="Tool Used (Optional)" />
            </form>

            <AddCustomerInline
              onAdded={(customer) => {
                setAdded((prev) => [...prev, customer]);
                setCustomerOverride(customer.id);
              }}
            />

            {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}

            <DialogFooter className="-mx-0 -mb-0 rounded-none border-0 bg-transparent p-0 sm:justify-stretch">
              <Button
                type="submit"
                form="start-work-form"
                data-agent-id="start-work-submit"
                size="lg"
                className="h-12 w-full text-base"
                disabled={pending || customers.length === 0}
              >
                {pending ? "Starting..." : "Start Work"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddCustomerInline({ onAdded }: { onAdded: (customer: CustomerOption) => void }) {
  const { mutate } = useSWRConfig();
  const [show, setShow] = useState(false);
  const { error, pending, run } = useApiForm(async (body: { name: string; mobile: string }) => {
    const { customer } = await apiFetch<{ customer: CustomerOption }>("/api/customers", {
      method: "POST",
      body: JSON.stringify(body),
    });
    onAdded(customer);
    setShow(false);
    await mutate((key) => typeof key === "string" && key.startsWith("/api/customers"));
  });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await run({ name: fd.get("name") as string, mobile: fd.get("mobile") as string });
  }

  if (!show) {
    return (
      <button
        type="button"
        onClick={() => setShow(true)}
        className="flex items-center gap-1.5 self-start text-sm font-semibold text-primary-text"
      >
        <Plus className="size-4" />
        Add New Customer
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Input name="name" placeholder="Customer name" className="h-10 text-sm" />
          <Input name="mobile" placeholder="Mobile number" className="h-10 text-sm" />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {pending ? "Adding..." : "Add"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setShow(false)}>
            Cancel
          </Button>
        </div>
      </form>
      {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}
