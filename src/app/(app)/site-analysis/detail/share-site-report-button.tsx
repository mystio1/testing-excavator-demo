"use client";

import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileSaver } from "@/lib/native/file-saver";
import { blobToBase64, nodeToPdfBlob, pdfNameSegment, waNumber } from "@/lib/bill-pdf";
import { formatCurrency } from "@/lib/utils/currency";
import { formatHours } from "@/lib/utils/hours";
import { SITE_REPORT_AREA_ID } from "./site-report";

const PDF_MIME = "application/pdf";

/**
 * Shares the Site Analysis report as a PDF.
 *
 * The same three routes the bill share uses, because no single one works
 * everywhere (see share-bill-button.tsx):
 *   - Android app: the FileSaver plugin's ACTION_SEND sheet (WhatsApp included).
 *   - Phone browsers: navigator.share with the file attached.
 *   - Desktop: no browser can attach a file to WhatsApp, so the PDF downloads
 *     and WhatsApp Web opens with the text ready to send alongside it.
 */
export function ShareSiteReportButton({
  siteName,
  businessName,
  customerMobile,
  period,
  totals,
}: {
  siteName: string;
  businessName: string;
  /** Used only on the desktop route, to open the right WhatsApp chat. */
  customerMobile: string | null;
  period: string;
  totals: { hours: number; revenue: number; received: number; pending: number; machines: number };
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  function message() {
    const lines = [
      businessName,
      `Site Analysis — ${siteName}`,
      `Period: ${period}`,
      `Machines: ${totals.machines}`,
      `Total work: ${formatHours(totals.hours)}`,
      `Total amount: ${formatCurrency(totals.revenue)}`,
      `Received: ${formatCurrency(totals.received)}`,
      `Pending: ${formatCurrency(totals.pending)}`,
    ];
    return lines.join("\n");
  }

  async function onShare() {
    const node = document.getElementById(SITE_REPORT_AREA_ID);
    if (!node) {
      setFailed("Could not find the report to share. Reload the page and try again.");
      return;
    }
    setBusy(true);
    setFailed(null);
    try {
      const blob = await nodeToPdfBlob(node);
      const filename = `Site-${pdfNameSegment(siteName, "report")}-Analysis.pdf`;
      const text = message();

      if (Capacitor.isNativePlatform()) {
        await FileSaver.shareFile({ data: await blobToBase64(blob), filename, mimeType: PDF_MIME, text });
        return;
      }

      const file = new File([blob], filename, { type: PDF_MIME });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `Site Analysis — ${siteName}`, text });
          return;
        } catch (err) {
          // Dismissing the share sheet is not a failure worth reporting.
          if (err instanceof DOMException && err.name === "AbortError") return;
          throw err;
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      window.open(
        `https://wa.me/${waNumber(customerMobile)}?text=${encodeURIComponent(`${text}\n\n(${filename} attached)`)}`,
        "_blank",
        "noopener,noreferrer",
      );
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Could not prepare the report for sharing");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="lg"
        variant="outline"
        className="h-11"
        data-agent-id="share-site-report"
        onClick={onShare}
        disabled={busy}
      >
        <FileDown className="size-5" />
        {busy ? "Preparing PDF..." : "Share Report (PDF)"}
      </Button>
      {failed && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {failed}
        </p>
      )}
    </div>
  );
}
