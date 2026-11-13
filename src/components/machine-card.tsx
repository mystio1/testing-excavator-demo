import Link from "next/link";
import { Gauge, MapPin, User, Wrench } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { ExcavatorLogo } from "@/components/excavator-logo";
import { formatHours } from "@/lib/utils/hours";
import { cn } from "@/lib/utils";
import type { Plain } from "@/lib/plain";
import type { listExcavators } from "@/lib/services/excavators";

type Excavator = Plain<Awaited<ReturnType<typeof listExcavators>>[number]>;

export function MachineCard({ excavator: ex }: { excavator: Excavator }) {
  return (
    <Link
      href={`/excavators/detail?id=${ex.id}`}
      // Handles for the in-app assistant. The label carries both the name and
      // the number so "Komatsu" and "machine number 2" reach the same card, and
      // two cards matching is a question for the owner, not a guess.
      data-agent-id="machine-card"
      data-agent-label={[ex.name, ex.machineNumber].filter(Boolean).join(" ")}
    >
      <Card className="card-hover animate-fade-in-up h-full overflow-hidden py-0">
        <div className="flex items-center justify-between gap-2 bg-primary/8 px-4 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ExcavatorLogo className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-bold">{ex.name}</p>
              {ex.machineNumber && (
                <p className="truncate text-xs text-muted-foreground">{ex.machineNumber}</p>
              )}
            </div>
          </div>
          <StatusBadge status={ex.status} />
        </div>
        <CardContent className="flex flex-col gap-2 px-4 py-3.5 text-sm">
          <Row icon={MapPin} label="Site" value={ex.currentSite ?? "—"} />
          <Row icon={User} label="Operator" value={ex.assignedOperator ?? "—"} />
          <Row icon={Gauge} label="Hour Meter" value={formatHours(ex.currentHourMeter)} />
          <Row
            icon={Wrench}
            label="Service"
            value={
              ex.serviceStatus.overdue
                ? `Overdue by ${Math.abs(ex.serviceStatus.dueInHours)} hrs`
                : `Due in ${ex.serviceStatus.dueInHours} hrs`
            }
            valueClassName={cn(
              ex.serviceStatus.overdue && "font-semibold text-destructive",
              ex.serviceStatus.dueSoon && !ex.serviceStatus.overdue && "font-semibold text-idle-foreground",
            )}
          />
        </CardContent>
      </Card>
    </Link>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  valueClassName,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn("truncate font-medium", valueClassName)}>{value}</span>
    </div>
  );
}
