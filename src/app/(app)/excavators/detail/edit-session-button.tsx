"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Pencil, Trash2 } from "lucide-react";
import { ApiError, apiFetch, swrFetcher } from "@/lib/api-client";
import { useApiForm } from "@/lib/use-api-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/native-select";
import { AttachmentPicker } from "@/components/attachment-picker";
import { TOOL_REQUIRED_MESSAGE } from "@/lib/attachments";
import { ChangeReview } from "@/components/change-review";
import { summarizeChanges, type FieldChange } from "@/lib/utils/change-summary";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export type EditableSession = {
  id: string;
  /** Optimistic-concurrency token: sent back as expectedVersion on save/delete. */
  version: number;
  customerId: string;
  operatorId: string;
  site: { name: string };
  startDate: string | Date;
  endDate: string | Date | null;
  startHourMeter: number;
  endHourMeter: number | null;
  totalHours: number;
  dieselLiters: number | null;
  attachment: string | null;
  notes: string | null;
  status: string;
  /** True when the job is already on a bill (the confirmation step warns that the bill is not rewritten). */
  billed?: boolean;
};

const day = (d: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

/** Admin can correct any job at any time — customer, site, operator, dates,
 * readings, hours, diesel, tool, notes — or remove it (unless billed). */
export function EditSessionButton({ session, invalidateKey }: { session: EditableSession; invalidateKey: string }) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // The version the dialog was opened with. SWR may refresh `session` in the
  // background while the user is typing; saving is still judged against what
  // they actually started from.
  const [loadedVersion, setLoadedVersion] = useState(session.version);
  const [conflict, setConflict] = useState(false);
  // After "Save": the changes waiting for the admin to answer "Are you sure you want to change this?".
  const [review, setReview] = useState<{ body: Record<string, unknown>; changes: FieldChange[] } | null>(null);
  const [nothingChanged, setNothingChanged] = useState(false);
  const [toolError, setToolError] = useState<string | null>(null);
  const { data: customersData } = useSWR<{ customers: { id: string; name: string }[] }>(
    open ? "/api/customers/options" : null,
    swrFetcher,
  );
  const { data: operatorsData } = useSWR<{ operators: { id: string; name: string }[] }>(
    open ? "/api/operators/options" : null,
    swrFetcher,
  );
  const { error, pending, run } = useApiForm(async (body: Record<string, unknown>) => {
    setConflict(false);
    try {
      await apiFetch(`/api/work-sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...body, expectedVersion: loadedVersion }),
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === "RESOURCE_MODIFIED") setConflict(true);
      throw e;
    }
  });

  function onOpenChange(next: boolean) {
    if (next) {
      setLoadedVersion(session.version);
      setConflict(false);
      setDeleteError(null);
      setReview(null);
      setNothingChanged(false);
      setToolError(null);
    }
    setOpen(next);
  }

  /** After a conflict: fetch the latest data and close, so reopening shows it. */
  async function reloadLatest() {
    await refresh();
    setOpen(false);
  }

  async function refresh() {
    await mutate(invalidateKey);
    await mutate((k) => typeof k === "string" && (k.startsWith("/api/excavators") || k.startsWith("/api/dashboard") || k.startsWith("/api/customers")));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Compulsory here too, for the same reason as on the reading: the tool is
    // what Site Analysis prices the job's hours by.
    if (!fd.get("attachment")) {
      setToolError(TOOL_REQUIRED_MESSAGE);
      return;
    }
    const body = {
      customerId: fd.get("customerId"),
      operatorId: fd.get("operatorId"),
      siteName: fd.get("siteName"),
      startDate: fd.get("startDate"),
      endDate: fd.get("endDate") || undefined,
      startHourMeter: fd.get("startHourMeter"),
      endHourMeter: fd.get("endHourMeter") || undefined,
      totalHours: fd.get("totalHours") || undefined,
      dieselLiters: fd.get("dieselLiters") || undefined,
      attachment: fd.get("attachment"),
      notes: fd.get("notes") || undefined,
    };
    const nameOf = (list: { id: string; name: string }[], id: unknown) => list.find((x) => x.id === id)?.name ?? String(id ?? "");
    const changes = summarizeChanges([
      { label: "Customer", before: nameOf(customers, session.customerId), after: nameOf(customers, body.customerId) },
      { label: "Operator", before: nameOf(operators, session.operatorId), after: nameOf(operators, body.operatorId) },
      { label: "Site", before: session.site.name, after: body.siteName },
      { label: "Start date", before: day(session.startDate), after: body.startDate },
      { label: "End date", before: day(session.endDate), after: body.endDate },
      { label: "Start reading", before: session.startHourMeter, after: body.startHourMeter },
      { label: "End reading", before: session.endHourMeter, after: body.endHourMeter },
      { label: "Total hours", before: session.totalHours, after: body.totalHours },
      { label: "Diesel (L)", before: session.dieselLiters, after: body.dieselLiters },
      { label: "Tool / attachment", before: session.attachment, after: body.attachment },
      { label: "Note", before: session.notes, after: body.notes },
    ]);
    setNothingChanged(changes.length === 0);
    if (changes.length > 0) setReview({ body, changes });
  }

  /** The admin answered "Yes" to "Are you sure you want to change this?". */
  async function confirmSave() {
    if (!review) return;
    const ok = await run(review.body);
    if (ok) {
      await refresh();
      setReview(null);
      setOpen(false);
    }
  }

  async function onDelete() {
    if (!window.confirm("Delete this work record and all its readings? This cannot be undone.")) return;
    setDeleting(true);
    setDeleteError(null);
    setConflict(false);
    try {
      await apiFetch(`/api/work-sessions/${session.id}?expectedVersion=${loadedVersion}`, { method: "DELETE" });
      await refresh();
      setOpen(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === "RESOURCE_MODIFIED") setConflict(true);
      setDeleteError(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setDeleting(false);
    }
  }

  const customers = customersData?.customers ?? [];
  const operators = operatorsData?.operators ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button type="button" size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label="Edit work record" />
        }
      >
        <Pencil className="size-4" />
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Work Record</DialogTitle>
        </DialogHeader>
        {review && (
          <ChangeReview
            changes={review.changes}
            pending={pending}
            error={error}
            note={session.billed ? "This work is already on a bill. Saving does not change that bill; edit the bill separately if its figures should change." : null}
            onBack={() => setReview(null)}
            onConfirm={confirmSave}
          />
        )}
        {/* Kept mounted (just hidden) while confirming, so "No, go back" returns to exactly what was typed. */}
        <form onSubmit={onSubmit} className={review ? "hidden" : "flex flex-col gap-4"}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="customerId">Customer</Label>
            <NativeSelect id="customerId" name="customerId" defaultValue={session.customerId} required className="h-11">
              {!customers.some((c) => c.id === session.customerId) && (
                <option value={session.customerId}>Current customer</option>
              )}
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="operatorId">Operator</Label>
            <NativeSelect id="operatorId" name="operatorId" defaultValue={session.operatorId} required className="h-11">
              {!operators.some((o) => o.id === session.operatorId) && (
                <option value={session.operatorId}>Current operator</option>
              )}
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="siteName">Site</Label>
            <Input id="siteName" name="siteName" defaultValue={session.site.name} required className="h-11" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="startDate">Start Date</Label>
              <Input id="startDate" name="startDate" type="date" defaultValue={day(session.startDate)} required className="h-11" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="endDate">End Date</Label>
              <Input id="endDate" name="endDate" type="date" defaultValue={day(session.endDate)} className="h-11" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="startHourMeter">Start Reading</Label>
              <Input id="startHourMeter" name="startHourMeter" type="number" step="0.1" min="0" defaultValue={session.startHourMeter} required className="h-11" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="endHourMeter">End Reading</Label>
              <Input id="endHourMeter" name="endHourMeter" type="number" step="0.1" min="0" defaultValue={session.endHourMeter ?? ""} className="h-11" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="totalHours">Total Hours</Label>
              <Input id="totalHours" name="totalHours" type="number" step="0.1" min="0" defaultValue={session.totalHours} className="h-11" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="dieselLiters">Diesel (L)</Label>
              <Input id="dieselLiters" name="dieselLiters" type="number" step="0.1" min="0" defaultValue={session.dieselLiters ?? ""} className="h-11" />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            If this job has approved daily readings, its hours come from those readings instead of Total Hours.
          </p>
          <AttachmentPicker
            name="attachment"
            label="Attachment / Tool Used"
            required
            error={toolError}
            onValueChange={() => setToolError(null)}
            defaultValue={session.attachment}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="notes">Note (Optional)</Label>
            <Input id="notes" name="notes" defaultValue={session.notes ?? ""} className="h-11" />
          </div>

          {nothingChanged && !review && <p role="status" className="text-sm text-muted-foreground">Nothing was changed.</p>}
          {((!review && error) || deleteError) && <p role="alert" className="text-sm font-medium text-destructive">{deleteError ?? error}</p>}
          {conflict && (
            <Button type="button" variant="outline" className="h-11" onClick={reloadLatest}>
              Reload latest version
            </Button>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-12 text-destructive" onClick={onDelete} disabled={deleting || pending}>
              <Trash2 className="size-4" />
              {deleting ? "Deleting..." : "Delete"}
            </Button>
            <Button type="submit" size="lg" className="h-12 flex-1 text-base" disabled={pending || deleting}>
              {pending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
