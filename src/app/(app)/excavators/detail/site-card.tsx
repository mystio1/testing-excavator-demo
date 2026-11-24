"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { MapPin } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useApiForm } from "@/lib/use-api-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export function SiteCard({
  excavatorId,
  currentSiteName,
  siteOptions,
}: {
  excavatorId: string;
  currentSiteName: string | null;
  siteOptions: { id: string; name: string; status?: string }[];
}) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  // "Add new site" swaps the dropdown for a name box; the PATCH finds or
  // creates the site by name either way.
  const [addingNew, setAddingNew] = useState(false);
  const currentSite = siteOptions.find((s) => s.name === currentSiteName);
  const groups = SITE_GROUPS.map((g) => ({
    ...g,
    sites: siteOptions.filter((s) => g.statuses.includes(s.status ?? "ACTIVE")),
  })).filter((g) => g.sites.length > 0);
  const { error, pending, run } = useApiForm(async (siteName: string) => {
    await apiFetch(`/api/excavators/${excavatorId}/site`, { method: "PATCH", body: JSON.stringify({ siteName }) });
    await mutate(`/api/excavators/${excavatorId}`);
  });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const siteName = String((addingNew ? fd.get("newSiteName") : fd.get("siteName")) ?? "").trim();
    if (await run(siteName)) setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // No saved sites yet → go straight to typing a new one.
        if (next) setAddingNew(siteOptions.length === 0);
        setOpen(next);
      }}
    >
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary-text">
            <MapPin className="size-5" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Site Location</p>
            <p className="font-bold">{currentSiteName ?? "Not set"}</p>
          </div>
        </div>
        <DialogTrigger render={<Button size="sm" variant="secondary" />}>
          {currentSiteName ? "Change" : "Set"}
        </DialogTrigger>
      </div>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{currentSiteName ? "Change Site Location" : "Set Site Location"}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This stays fixed for the machine until you (or an approved operator request) change it again — it won&rsquo;t
          reset day to day.
        </p>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={addingNew ? "newSiteName" : "siteName"} className="text-base">
              Site
            </Label>
            {!addingNew ? (
              <>
                <NativeSelect
                  key={currentSiteName}
                  id="siteName"
                  name="siteName"
                  defaultValue={currentSite?.name ?? ""}
                  required
                  className="h-12 text-base"
                  onChange={(e) => {
                    if (e.target.value === ADD_NEW) setAddingNew(true);
                  }}
                >
                  <option value="" disabled>
                    Select a site
                  </option>
                  {groups.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.sites.map((s) => (
                        <option key={s.id} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  <option value={ADD_NEW}>+ Add new site</option>
                </NativeSelect>
                <button
                  type="button"
                  onClick={() => setAddingNew(true)}
                  className="self-start text-sm font-semibold text-primary-text"
                >
                  + Add New Site
                </button>
              </>
            ) : (
              <>
                <Input
                  id="newSiteName"
                  name="newSiteName"
                  placeholder="e.g. Wagholi"
                  required
                  className="h-12 text-base"
                  autoFocus
                />
                {siteOptions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAddingNew(false)}
                    className="self-start text-sm font-semibold text-muted-foreground"
                  >
                    Pick an existing site instead
                  </button>
                )}
              </>
            )}
          </div>

          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}

          <DialogFooter className="-mx-0 -mb-0 rounded-none border-0 bg-transparent p-0 sm:justify-stretch">
            <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={pending}>
              {pending ? "Saving..." : "Save Site"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const ADD_NEW = "__add_new_site__";

/** Dropdown sections, in order: sites still running first, then finished ones. */
const SITE_GROUPS: { label: string; statuses: string[] }[] = [
  { label: "Ongoing sites", statuses: ["ACTIVE"] },
  { label: "On hold", statuses: ["ON_HOLD"] },
  { label: "Completed sites", statuses: ["COMPLETED"] },
];
