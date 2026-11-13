"use client";

import useSWR from "swr";
import { Bot, CheckCircle2, CircleHelp, Clock } from "lucide-react";
import { swrFetcher } from "@/lib/api-client";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import Loading from "../../loading";

/**
 * What the assistant did, for the owner to check up on.
 *
 * The rows have always been written; nothing showed them. For someone who
 * cannot read the screen well enough to catch a mistake as it happens, being
 * able to look afterwards is the whole safety net — so this is plain, newest
 * first, and says which of three things happened in words rather than a
 * status badge.
 *
 * Reachable by asking, too: `assistant.history.view` is a registered
 * capability, so "tumne kya kiya?" opens this page.
 */

type Action = {
  taskId: string;
  workflowId: string | null;
  fields: Record<string, unknown> | null;
  when: string;
  outcome: "pending" | "saved" | "unconfirmed";
  detail: string | null;
};

/** Plain names for the capabilities that can appear here — writes only, since
 * reads leave no trail. Falls back to the id, which is better than blank. */
const WHAT: Record<string, string> = {
  "work.start": "Started a job",
  "work.stop": "Finished a job",
  "reading.add": "Added a day's reading",
  "machine.allocate_operator": "Put an operator on a machine",
  "operator.leave.add": "Recorded leave",
  "operator.transaction.add": "Recorded money for an operator",
  "customer.create": "Added a customer",
};

const OUTCOME = {
  saved: { icon: CheckCircle2, text: "Saved", className: "text-working" },
  unconfirmed: { icon: CircleHelp, text: "Not sure it saved — worth checking", className: "text-destructive" },
  pending: { icon: Clock, text: "You approved it; no result came back", className: "text-muted-foreground" },
} as const;

/** "Komatsu PC200 · Wakad · 1200" — the values as they were approved. */
function describe(fields: Record<string, unknown> | null): string {
  if (!fields) return "";
  return Object.values(fields)
    .filter((v) => v !== null && v !== undefined && v !== "")
    .map((v) => String(v))
    .join(" · ");
}

export default function AssistantHistoryPage() {
  const { data } = useSWR<{ actions: Action[] }>("/api/agent/history", swrFetcher);

  if (!data) return <Loading />;
  const { actions } = data;

  return (
    <div>
      <PageHeader title="What the assistant did" backHref="/settings" />
      {/* Annotated so the assistant can open this page when asked. The empty
          state is inside it on purpose: "it has not done anything" is a real
          answer to "what have you done". */}
      <div className="flex flex-col gap-3 px-4 pb-6 md:px-8" data-agent-id="assistant-history">
        {actions.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="Nothing yet"
            description="Anything you ask the assistant to save will be listed here, with whether it worked."
          />
        ) : (
          actions.map((action) => {
            const outcome = OUTCOME[action.outcome];
            const Icon = outcome.icon;
            return (
              <Card key={action.taskId}>
                <CardContent className="flex flex-col gap-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-base font-bold">
                      {action.workflowId ? (WHAT[action.workflowId] ?? action.workflowId) : "Something"}
                    </p>
                    <p className="shrink-0 text-sm text-muted-foreground">
                      {new Date(action.when).toLocaleString()}
                    </p>
                  </div>
                  {describe(action.fields) && <p className="text-sm">{describe(action.fields)}</p>}
                  <p className={`flex items-center gap-1.5 text-sm font-semibold ${outcome.className}`}>
                    <Icon className="size-4" />
                    {outcome.text}
                  </p>
                  {action.detail && <p className="text-sm text-muted-foreground">{action.detail}</p>}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
