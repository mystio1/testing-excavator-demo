"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { CalendarPlus } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useApiForm } from "@/lib/use-api-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/native-select";
import { LEAVE_TYPES, LEAVE_TYPE_LABEL } from "@/lib/validation/operatorPeriod";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** A leave can only sit in the gap after a closed session — the server enforces it. */
export function AddLeaveDialog({ operatorId }: { operatorId: string }) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const { error, pending, run } = useApiForm(async (body: Record<string, unknown>) => {
    await apiFetch(`/api/operators/${operatorId}/leaves`, { method: "POST", body: JSON.stringify(body) });
  });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const ok = await run({
      startDate: fd.get("startDate"),
      endDate: fd.get("endDate"),
      type: fd.get("type"),
      reason: fd.get("reason") || undefined,
    });
    if (ok) {
      await mutate((key) => typeof key === "string" && key.startsWith("/api/operators/"));
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button size="lg" variant="outline" className="h-11" />}
        data-agent-id="add-leave-trigger"
      >
        <CalendarPlus className="size-4" />
        Record Leave
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Leave</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="leaveStart" className="text-base">
                From
              </Label>
              <Input
                id="leaveStart"
                name="startDate"
                type="date"
                required
                className="h-12 text-base"
                data-agent-id="leaveStart"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="leaveEnd" className="text-base">
                To
              </Label>
              <Input
                id="leaveEnd"
                name="endDate"
                type="date"
                required
                className="h-12 text-base"
                data-agent-id="leaveEnd"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="leaveKind" className="text-base">
              Type
            </Label>
            <NativeSelect
              id="leaveKind"
              name="type"
              defaultValue="UNPAID"
              className="h-12 text-base"
              data-agent-id="leaveType"
            >
              {LEAVE_TYPES.map((v) => (
                <option key={v} value={v}>
                  {LEAVE_TYPE_LABEL[v]}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="leaveReason" className="text-base">
              Reason (Optional)
            </Label>
            <Input id="leaveReason" name="reason" className="h-12 text-base" />
          </div>

          <p className="text-xs text-muted-foreground">
            Leave can fall inside a session or in a gap between sessions. Unpaid days inside a session are taken off
            that session&apos;s salary; paid leave in a gap accrues at the previous session&apos;s rate.
          </p>

          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}

          <DialogFooter className="-mx-0 -mb-0 rounded-none border-0 bg-transparent p-0 sm:justify-stretch">
            <Button
              type="submit"
              size="lg"
              className="h-12 w-full text-base"
              disabled={pending}
              data-agent-id="add-leave-submit"
            >
              {pending ? "Saving..." : "Record Leave"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
