"use client";

import Link from "next/link";
import useSWR from "swr";
import { Plus, Truck } from "lucide-react";
import type { getMachinePerformanceSummary, listExcavators } from "@/lib/services/excavators";
import { swrFetcher } from "@/lib/api-client";
import type { Plain } from "@/lib/plain";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { MachineCard } from "@/components/machine-card";
import { MachinePerformanceList } from "@/components/machine-performance-list";
import { EmptyState } from "@/components/empty-state";
import { ReorderMachines } from "./reorder-machines";
import Loading from "../loading";

type ExcavatorsData = {
  excavators: Plain<Awaited<ReturnType<typeof listExcavators>>>;
  machinePerformance: Plain<Awaited<ReturnType<typeof getMachinePerformanceSummary>>>;
};

export default function ExcavatorsPage() {
  const { data } = useSWR<ExcavatorsData>("/api/excavators", swrFetcher, { dedupingInterval: 15_000 });

  if (!data) return <Loading />;
  const { excavators, machinePerformance } = data;

  return (
    <div>
      <PageHeader
        title="My Excavators"
        action={
          <Button size="lg" className="h-11" nativeButton={false} render={<Link href="/excavators/new" />}>
            <Plus className="size-5" />
            Add Machine
          </Button>
        }
      />

      {/* The assistant's handle wraps BOTH the list and the empty state. Inside
          the list alone it vanished for a business with no machines, so the
          assistant answered "I couldn't confirm" for a page that was correct
          and simply empty — "you have no machines yet" is a real answer to
          "show me my machines". Found by the browser pass on an empty
          business; site-list had the same shape. */}
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-8" data-agent-id="machine-list">
        {excavators.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No Excavators Added Yet"
            description="Add your first excavator to start managing your fleet."
            actionLabel="Add First Machine"
            actionHref="/excavators/new"
          />
        ) : (
          <>
            <div className="flex justify-end">
              <ReorderMachines key={excavators.map((e) => e.id).join(",")} machines={excavators} />
            </div>
            <MachinePerformanceList machines={machinePerformance} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {excavators.map((ex) => (
                <MachineCard key={ex.id} excavator={ex} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
