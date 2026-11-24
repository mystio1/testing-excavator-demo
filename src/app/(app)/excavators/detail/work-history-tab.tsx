"use client";

import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import useSWRInfinite, { unstable_serialize } from "swr/infinite";
import type { listWorkHistory } from "@/lib/services/workSessions";
import { swrFetcher } from "@/lib/api-client";
import type { Plain } from "@/lib/plain";
import { formatDate, formatDateRange, formatDateTime } from "@/lib/utils/dates";
import { formatHours } from "@/lib/utils/hours";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/native-select";
import { StatusBadge } from "@/components/status-badge";
import { DeleteReadingButton } from "./delete-reading-button";
import { EditReadingButton } from "./edit-reading-button";
import { EditSessionButton } from "./edit-session-button";

type CustomerOption = { id: string; name: string; companyName: string | null };
type OperatorOption = { id: string; name: string };
type HistoryPage = Plain<Awaited<ReturnType<typeof listWorkHistory>>>;

/** Page size for the History tab; the server returns `nextCursor` while more remain. */
const PAGE_SIZE = 50;

export function WorkHistoryTab({ excavatorId }: { excavatorId: string }) {
  const searchParams = useSearchParams();
  const filters = {
    customerId: searchParams.get("customerId") ?? "",
    operatorId: searchParams.get("operatorId") ?? "",
    siteName: searchParams.get("site") ?? "",
    from: searchParams.get("from") ?? "",
    to: searchParams.get("to") ?? "",
  };

  // Same SWR keys StartWorkDialog/AssignOperatorDialog/ApproveWorkRequestDialog
  // use for these — shares one cached fetch instead of each component
  // re-requesting the same option lists.
  const { data: customersData } = useSWR<{ customers: CustomerOption[] }>("/api/customers/options", swrFetcher);
  const { data: operatorsData } = useSWR<{ operators: OperatorOption[] }>("/api/operators/options", swrFetcher);

  const query = new URLSearchParams();
  if (filters.customerId) query.set("customerId", filters.customerId);
  if (filters.operatorId) query.set("operatorId", filters.operatorId);
  if (filters.siteName) query.set("site", filters.siteName);
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);

  // Cursor pagination: each page's URL carries the previous page's nextCursor.
  const getKey = (_pageIndex: number, previousPage: HistoryPage | null) => {
    if (previousPage && !previousPage.nextCursor) return null;
    const page = new URLSearchParams(query);
    page.set("limit", String(PAGE_SIZE));
    if (previousPage?.nextCursor) page.set("cursor", previousPage.nextCursor);
    return `/api/excavators/${excavatorId}/work-history?${page.toString()}`;
  };
  const { data: pages, size, setSize, isValidating } = useSWRInfinite<HistoryPage>(getKey, swrFetcher);
  // The edit/delete buttons revalidate every loaded page through this key.
  const invalidateKey = unstable_serialize(getKey);
  const history = pages?.flatMap((p) => p.history) ?? [];
  const hasMore = pages ? pages[pages.length - 1]?.nextCursor != null : false;
  const loadingMore = isValidating && size > (pages?.length ?? 0);
  const customers = customersData?.customers ?? [];
  const operators = operatorsData?.operators ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent>
          <form method="get" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <input type="hidden" name="tab" value="history" />
            <input type="hidden" name="id" value={excavatorId} />
            <NativeSelect name="customerId" aria-label="Customer" defaultValue={filters.customerId} className="h-11">
              <option value="">All Customers</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect name="operatorId" aria-label="Operator" defaultValue={filters.operatorId} className="h-11">
              <option value="">All Operators</option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
            {/* col-span-2 on mobile — half a 2-col mobile row clips a native
                date input's own "dd-mm-yyyy" text, leaving only the
                calendar icon visible. Visible labels too — an empty date
                input shows no placeholder text at all on some mobile
                browsers, so an aria-label alone left the field looking like
                a plain blank box with no hint of what it's for. */}
            <div className="col-span-2 flex flex-col gap-1 md:col-span-1">
              <Label htmlFor="wh-from-date" className="text-xs text-muted-foreground">
                From Date
              </Label>
              <Input id="wh-from-date" name="from" type="date" defaultValue={filters.from} className="h-11" />
            </div>
            <div className="col-span-2 flex flex-col gap-1 md:col-span-1">
              <Label htmlFor="wh-to-date" className="text-xs text-muted-foreground">
                To Date
              </Label>
              <Input id="wh-to-date" name="to" type="date" defaultValue={filters.to} className="h-11" />
            </div>
            <Input
              name="site"
              placeholder="Site"
              defaultValue={filters.siteName}
              className="col-span-2 h-11 md:col-span-3"
            />
            <Button type="submit" className="h-11">
              Filter
            </Button>
          </form>
        </CardContent>
      </Card>

      {history.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">No work history found.</CardContent>
        </Card>
      )}

      {history.map((session) => (
        <Card key={session.id}>
          <CardContent className="flex flex-col gap-1">
            <div className="flex items-start justify-between gap-2">
              <p className="font-bold">{session.customer.name}</p>
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1">
                  {session.status === "ACTIVE" && <StatusBadge status="WORKING" />}
                  <EditSessionButton
                    session={session}
                    invalidateKey={invalidateKey}
                  />
                </div>
                <ToolTag tool={sessionTool(session)} />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{session.site.name}</p>
            {/* The WORK dates are the main date; when the operator submitted it is a separate, secondary line. */}
            <p className="text-sm">{formatDateRange(session.startDate, session.endDate)}</p>
            {session.submittedAt && (
              <p className="text-xs text-muted-foreground">Submitted {formatDateTime(session.submittedAt)}</p>
            )}
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Operator: {session.operator.name}</span>
              <span className="font-semibold">{formatHours(session.totalHours)}</span>
            </div>
            <div className="grid grid-cols-2 gap-y-1 text-sm">
              <span className="text-muted-foreground">Start Reading</span>
              <span className="text-right font-semibold">{formatHours(session.startHourMeter)}</span>
              <span className="text-muted-foreground">End Reading</span>
              <span className="text-right font-semibold">
                {session.endHourMeter != null ? formatHours(session.endHourMeter) : "—"}
              </span>
              {session.dieselLiters != null && (
                <>
                  <span className="text-muted-foreground">Diesel Taken</span>
                  <span className="text-right font-semibold">
                    {session.dieselLiters} L{session.dieselDate ? ` (${formatDate(session.dieselDate)})` : ""}
                  </span>
                </>
              )}
            </div>

            {session.dailyLogs.length > 0 && (
              <div className="mt-2 flex flex-col border-t pt-2">
                {session.dailyLogs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between gap-2 py-1">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(log.date)}
                      {log.operatorName && ` — ${log.operatorName}`}
                      {log.source === "OPERATOR" && (
                        <span className="block">Submitted {formatDateTime(log.createdAt)}</span>
                      )}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {log.kind === "DIESEL_ONLY" ? (
                        <>
                          <Badge className="bg-idle text-idle-foreground">Diesel only</Badge>
                          <span className="text-xs font-semibold">{log.dieselLiters ?? 0} L</span>
                          <span className="text-xs text-muted-foreground">0 h</span>
                        </>
                      ) : (
                        <>
                          {log.attachment && <ToolTag tool={log.attachment} small />}
                          <span className="text-xs font-semibold">{formatHours(log.hoursWorked)}</span>
                          <EditReadingButton
                            log={log}
                            invalidateKey={invalidateKey}
                          />
                        </>
                      )}
                      <DeleteReadingButton
                        logId={log.id}
                        version={log.version}
                        invalidateKey={invalidateKey}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {hasMore && (
        <Button type="button" variant="outline" className="h-11" disabled={loadingMore} onClick={() => setSize(size + 1)}>
          {loadingMore ? "Loading..." : "Load more"}
        </Button>
      )}
    </div>
  );
}

/** The tool a record was worked with: the job's own, else the tools its readings name. */
function sessionTool(session: { attachment: string | null; dailyLogs: { attachment: string | null; kind?: string }[] }) {
  if (session.attachment) return session.attachment;
  const tools = [...new Set(session.dailyLogs.map((l) => l.attachment).filter((t): t is string => !!t))];
  return tools.length ? tools.join(", ") : null;
}

function ToolTag({ tool, small }: { tool: string | null; small?: boolean }) {
  return (
    <span
      className={
        "rounded-md border border-amber-300 bg-amber-100 font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200 " +
        (small ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-xs")
      }
    >
      {small ? tool : `Tool: ${tool ?? "Not set"}`}
    </span>
  );
}
