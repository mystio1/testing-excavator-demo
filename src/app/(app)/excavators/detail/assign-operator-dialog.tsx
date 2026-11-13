"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { HardHat } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useApiForm } from "@/lib/use-api-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/native-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function AssignOperatorDialog({
  excavatorId,
  operators,
  hasCurrentOperator,
}: {
  excavatorId: string;
  operators: { id: string; name: string }[];
  hasCurrentOperator: boolean;
}) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const { error, pending, run } = useApiForm(async (operatorId: string) => {
    await apiFetch(`/api/excavators/${excavatorId}/assign-operator`, {
      method: "POST",
      body: JSON.stringify({ operatorId }),
    });
  });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const operatorId = new FormData(e.currentTarget).get("operatorId") as string;
    const ok = await run(operatorId);
    if (ok) {
      await mutate(`/api/excavators/${excavatorId}`);
      await mutate("/api/operators");
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger data-agent-id="assign-operator-trigger" render={<Button size="sm" variant="secondary" />}>
        <HardHat className="size-4" />
        {hasCurrentOperator ? "Change" : "Assign"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{hasCurrentOperator ? "Change Operator" : "Assign Operator"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="operatorId" className="text-base">
              Operator
            </Label>
            {operators.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add an operator first.</p>
            ) : (
              <NativeSelect id="operatorId" data-agent-id="assign-operator-select" name="operatorId" required defaultValue="">
                <option value="" disabled>
                  Select operator
                </option>
                {operators.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </div>

          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}

          <DialogFooter className="-mx-0 -mb-0 rounded-none border-0 bg-transparent p-0 sm:justify-stretch">
            <Button type="submit" data-agent-id="assign-operator-submit" size="lg" className="h-12 w-full text-base" disabled={pending || operators.length === 0}>
              {pending ? "Saving..." : hasCurrentOperator ? "Change Operator" : "Assign Operator"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
