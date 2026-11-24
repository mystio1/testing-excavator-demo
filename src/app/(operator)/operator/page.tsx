"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/utils/dates";
import { formatHours } from "@/lib/utils/hours";
import { ot, type OperatorLang } from "@/lib/i18n/operator";
import { ExcavatorLogo } from "@/components/excavator-logo";
import { usePageTitle } from "@/components/page-title";
import { SubmitReadingDialog } from "../submit-reading-dialog";
import { StartWorkDialog } from "../start-work-dialog";
import { EndWorkDialog } from "../end-work-dialog";
import { EditWorkDialog } from "../edit-work-dialog";
import { DieselOnlyDialog } from "../diesel-only-dialog";
import { OperatorLanguageSwitcher } from "../operator-language-switcher";

type DailyLog = {
  id: string;
  date: Date;
  hoursWorked: number;
  status: string;
  /** "ADMIN" when the owner entered the reading, "OPERATOR" when this operator did. */
  source?: string;
  kind?: "WORK" | "DIESEL_ONLY";
  dieselLiters?: number | null;
  createdAt?: Date;
};
type WorkRequest = {
  id: string;
  /** "ADMIN" when the owner entered the job rather than this operator. */
  source?: string;
  status: string;
  startDate: Date;
  startHourMeter: number;
  endDate: Date | null;
  endHourMeter: number | null;
  siteName: string | null;
  attachment: string | null;
  dieselLiters: number | null;
  dieselDate: Date | null;
  notes: string | null;
  rejectionNote: string | null;
  createdAt?: Date;
  /** When the operator submitted (the work dates above are when it was DONE). */
  submittedAt?: Date | null;
};
type Excavator = {
  id: string;
  name: string;
  machineNumber: string | null;
  currentHourMeter: number;
  currentSite: { name: string } | null;
};
type ActiveSession = {
  id: string;
  customer: { name: string };
  site: { name: string };
  dailyLogs: DailyLog[];
};
type HomeData = {
  operatorLang: OperatorLang;
  excavator: Excavator | null;
  activeSession: ActiveSession | null;
  openRequests: WorkRequest[];
  recentRequests: WorkRequest[];
  /** End meter from the most recent non-rejected daily log (pending included).
   * Use this as the default start reading for a new daily log submission. */
  latestEndMeter: number;
};

export default function OperatorHomePage() {
  const { data } = useSWR<HomeData>("/api/operator/home", swrFetcher);
  usePageTitle(data?.excavator?.name);

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-10">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary-text">
          <ExcavatorLogo animated className="size-8" />
        </div>
      </div>
    );
  }

  const { operatorLang: lang, excavator, activeSession, openRequests, recentRequests, latestEndMeter } = data;
  const t = (key: string, vars?: Record<string, string | number>) => ot(lang, key, vars);

  const LOG_STATUS_BADGE: Record<string, { label: string; className: string }> = {
    APPROVED: { label: t("status.approved"), className: "bg-working text-working-foreground" },
    PENDING: { label: t("status.pending"), className: "bg-idle text-idle-foreground" },
    REJECTED: { label: t("status.rejected"), className: "bg-destructive/10 text-destructive" },
  };

  const REQUEST_STATUS_BADGE: Record<string, { label: string; className: string }> = {
    ACTIVE: { label: t("status.inProgress"), className: "bg-primary text-primary-foreground" },
    PENDING: { label: t("status.pendingApproval"), className: "bg-idle text-idle-foreground" },
    APPROVED: { label: t("status.approved"), className: "bg-working text-working-foreground" },
    REJECTED: { label: t("status.rejected"), className: "bg-destructive/10 text-destructive" },
  };

  if (!excavator) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <OperatorLanguageSwitcher lang={lang} />
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <h1>{t("home.notAssigned")}</h1>
          </CardContent>
        </Card>
      </div>
    );
  }

  // An admin-started job takes priority — the existing daily-reading flow
  // is unaffected by operator-initiated start/end.
  if (activeSession) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <OperatorLanguageSwitcher lang={lang} />
        <Card>
          <CardContent className="flex flex-col gap-2">
            <h1 className="text-lg font-bold">
              {excavator.name}
              {excavator.machineNumber ? ` (${excavator.machineNumber})` : ""}
            </h1>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("home.currentHourMeter")}</span>
              <span className="font-semibold">{formatHours(excavator.currentHourMeter)}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("home.onJob", { customer: activeSession.customer.name, site: activeSession.site.name })}
            </p>
          </CardContent>
        </Card>

        <SubmitReadingDialog workSessionId={activeSession.id} currentHourMeter={latestEndMeter ?? excavator.currentHourMeter} lang={lang} />
        <DieselOnlyDialog lang={lang} />

        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-muted-foreground">{t("home.recentReadings")}</p>
          {activeSession.dailyLogs.length === 0 && (
            <Card>
              <CardContent className="py-6 text-center text-muted-foreground">{t("home.noReadings")}</CardContent>
            </Card>
          )}
          {activeSession.dailyLogs.map((log) => {
            // A reading the owner entered was never the operator's to submit or
            // wait on, so it is marked by who added it rather than by a status
            // the operator cannot act on.
            const badge =
              log.source === "ADMIN"
                ? { label: "ADMIN", className: "bg-purple text-purple-foreground" }
                : (LOG_STATUS_BADGE[log.status] ?? LOG_STATUS_BADGE.APPROVED);
            return (
              <Card key={log.id}>
                <CardContent className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{formatDate(log.date)}</p>
                    <p className="text-sm text-muted-foreground">
                      {log.kind === "DIESEL_ONLY"
                        ? `${t("home.dieselOnly")} - ${t("home.dieselOnlyLine", { litres: log.dieselLiters ?? 0 })}`
                        : formatHours(log.hoursWorked)}
                    </p>
                    {log.createdAt && (
                      <p className="text-xs text-muted-foreground">
                        {log.source === "ADMIN" ? t("home.addedByAdmin") : t("home.submitted")}{" "}
                        {formatDateTime(log.createdAt)}
                      </p>
                    )}
                  </div>
                  <Badge className={badge.className}>{badge.label}</Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  const openIds = new Set(openRequests.map((r) => r.id));
  const history = recentRequests.filter((r) => !openIds.has(r.id));

  return (
    <div className="flex flex-col gap-4 p-4">
      <OperatorLanguageSwitcher lang={lang} />
      <Card>
        <CardContent className="flex flex-col gap-2">
          <h1 className="text-lg font-bold">
            {excavator.name}
            {excavator.machineNumber ? ` (${excavator.machineNumber})` : ""}
          </h1>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("home.currentHourMeter")}</span>
            <span className="font-semibold">{formatHours(excavator.currentHourMeter)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Hide Start Work when an active job is already running (the End Work button is on the job card). */}
      {!openRequests.some((r) => r.status === "ACTIVE") && (
        <>
          <StartWorkDialog
            currentHourMeter={excavator.currentHourMeter}
            currentSiteName={excavator.currentSite?.name ?? null}
            lang={lang}
          />
          <DieselOnlyDialog lang={lang} />
        </>
      )}

      {openRequests.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">{t("home.noJobRunning")}</p>
      )}

      {openRequests.map((req) => {
        const badge = REQUEST_STATUS_BADGE[req.status] ?? REQUEST_STATUS_BADGE.ACTIVE;
        return (
          <Card key={req.id}>
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="font-semibold">
                  {req.status === "ACTIVE" && t("home.youStarted")}
                  {req.status === "PENDING" && t("home.waitingApproval")}
                  {req.status === "REJECTED" && t("home.sentBack")}
                </p>
                <Badge className={badge.className}>{badge.label}</Badge>
              </div>

              {req.status === "REJECTED" && req.rejectionNote && (
                <p className="text-sm text-muted-foreground">{t("home.adminNote", { note: req.rejectionNote })}</p>
              )}

              <div className="grid grid-cols-2 gap-y-1 text-sm">
                <span className="text-muted-foreground">{t("home.workDate")}</span>
                <span className="text-right font-semibold">{formatDate(req.startDate)}</span>
                <span className="text-muted-foreground">{t("home.startingReading")}</span>
                <span className="text-right font-semibold">{formatHours(req.startHourMeter)}</span>
                {req.endHourMeter != null && (
                  <>
                    <span className="text-muted-foreground">{t("home.ended")}</span>
                    <span className="text-right font-semibold">{req.endDate ? formatDate(req.endDate) : "—"}</span>
                    <span className="text-muted-foreground">{t("home.endingReading")}</span>
                    <span className="text-right font-semibold">{formatHours(req.endHourMeter)}</span>
                  </>
                )}
                {req.siteName && (
                  <>
                    <span className="text-muted-foreground">{t("home.site")}</span>
                    <span className="text-right font-semibold">{req.siteName}</span>
                  </>
                )}
                {req.attachment && (
                  <>
                    <span className="text-muted-foreground">{t("home.attachment")}</span>
                    <span className="text-right font-semibold">{req.attachment}</span>
                  </>
                )}
                {req.dieselLiters != null && (
                  <>
                    <span className="text-muted-foreground">{t("home.diesel")}</span>
                    <span className="text-right font-semibold">
                      {req.dieselLiters} L{req.dieselDate ? ` (${formatDate(req.dieselDate)})` : ""}
                    </span>
                  </>
                )}
                {req.notes && (
                  <>
                    <span className="text-muted-foreground">{t("home.note")}</span>
                    <span className="text-right font-semibold">{req.notes}</span>
                  </>
                )}
                {(req.submittedAt ?? req.createdAt) && (
                  <>
                    <span className="text-muted-foreground">{t("home.submitted")}</span>
                    <span className="text-right font-semibold">
                      {formatDateTime((req.submittedAt ?? req.createdAt) as Date)}
                    </span>
                  </>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                {(req.status === "ACTIVE" || req.status === "PENDING") && (
                  <EditWorkDialog
                    requestId={req.id}
                    status={req.status}
                    startDate={req.startDate}
                    endDate={req.endDate}
                    startHourMeter={req.startHourMeter}
                    endHourMeter={req.endHourMeter}
                    attachment={req.attachment}
                    siteName={req.siteName}
                    dieselLiters={req.dieselLiters}
                    dieselDate={req.dieselDate}
                    notes={req.notes}
                    lang={lang}
                  />
                )}
                {req.status === "ACTIVE" && (
                  <div className="flex-1">
                    <EndWorkDialog
                      requestId={req.id}
                      startHourMeter={req.startHourMeter}
                      currentHourMeter={excavator.currentHourMeter}
                      startDate={req.startDate}
                      attachment={req.attachment}
                      lang={lang}
                    />
                  </div>
                )}
                {req.status === "REJECTED" && (
                  <div className="flex-1">
                    <EndWorkDialog
                      requestId={req.id}
                      startHourMeter={req.startHourMeter}
                      currentHourMeter={req.endHourMeter ?? excavator.currentHourMeter}
                      startDate={req.startDate}
                      endDate={req.endDate}
                      attachment={req.attachment}
                      triggerLabel={t("edit.resubmit")}
                      lang={lang}
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {history.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-muted-foreground">{t("home.recentJobRequests")}</p>
          {history.map((req) => {
            // The operator never submitted an admin's job, so a status badge
            // about their own request would be meaningless on it.
            const badge =
              req.source === "ADMIN"
                ? { label: "ADMIN", className: "bg-purple text-purple-foreground" }
                : (REQUEST_STATUS_BADGE[req.status] ?? REQUEST_STATUS_BADGE.APPROVED);
            return (
              <Card key={req.id}>
                <CardContent className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{formatDate(req.startDate)}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatHours(req.startHourMeter)}
                      {req.endHourMeter != null ? ` → ${formatHours(req.endHourMeter)}` : ""}
                    </p>
                  </div>
                  <Badge className={badge.className}>{badge.label}</Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
