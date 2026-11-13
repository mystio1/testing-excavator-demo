"use client";

import useSWR from "swr";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Snowflake } from "lucide-react";
import { ApiError, swrFetcher } from "@/lib/api-client";
import { useLogout } from "@/lib/use-logout";
import { PIN_UNLOCKED_KEY } from "@/lib/appLock";
import { ExcavatorLogo } from "@/components/excavator-logo";
import { AppLockScreen } from "@/components/app-lock-screen";
import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/shell/sidebar";
import { BottomNav } from "@/components/shell/bottom-nav";
import { MobileTopBar } from "@/components/shell/mobile-top-bar";
import { DesktopTopHeader } from "@/components/shell/desktop-top-header";
import { AssistantPanel } from "@/components/agent/assistant-panel";

type Alert = { level: "warning" | "danger"; message: string; href: string };
type LayoutData = {
  businessName: string;
  ownerName: string;
  alerts: Alert[];
  frozen: boolean;
  hasPin: boolean;
  /** Per-business switch. Absent on an older cached response, which is treated
   * as off rather than on: not offering the assistant is recoverable, offering
   * one the server will refuse is just a button that fails. */
  assistantEnabled?: boolean;
};

function FrozenNotice() {
  const { logout, pending } = useLogout();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary-text">
        <Snowflake className="size-9" />
      </div>
      <h1 className="text-xl font-bold">Account Temporarily Frozen</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        This account has been frozen by our support team. Your data is safe — contact support for recovery.
      </p>
      <Button onClick={logout} disabled={pending} variant="secondary">
        {pending ? "Logging out..." : "Log Out"}
      </Button>
    </main>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, error } = useSWR<LayoutData>("/api/layout", swrFetcher, {
    // Purely a client-side dedup window (the server computes this fresh on
    // every call, no server-side cache) — just avoids redundant simultaneous
    // requests if multiple components mount against this same SWR key.
    dedupingInterval: 15_000,
    revalidateOnFocus: true,
    // These alerts carry the pending-approval counts, so work an operator has
    // just sent surfaces wherever the admin happens to be. A minute rather than
    // the approvals screen's ten seconds: this runs on every admin page, and
    // getAlerts is several queries, so it buys notice without the load.
    refreshInterval: 60_000,
  });
  // Lazy-init from sessionStorage — safe even though it runs on first
  // render, because the "!data" branch below shows the same Loading state
  // regardless of this value until the client-side fetch actually resolves.
  const [unlocked, setUnlocked] = useState(() => {
    try {
      return sessionStorage.getItem(PIN_UNLOCKED_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      router.replace("/login");
    }
  }, [error, router]);

  if (!data) {
    // First paint of the whole app shell — distinct from (app)/loading.tsx,
    // which only covers content swapping once this shell already exists.
    return (
      <div role="status" className="flex min-h-screen flex-col items-center justify-center gap-4">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary-text">
          <ExcavatorLogo animated className="size-9" />
        </div>
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  if (data.frozen) {
    return <FrozenNotice />;
  }

  if (data.hasPin && !unlocked) {
    return (
      <AppLockScreen
        onUnlocked={() => {
          try {
            sessionStorage.setItem(PIN_UNLOCKED_KEY, "1");
          } catch {
            // Private-browsing/storage-blocked — falls back to asking again
            // next render, same as if nothing had been saved at all.
          }
          setUnlocked(true);
        }}
      />
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Bypass block (WCAG 2.4.1): the first Tab stop jumps past the sidebar
          and header straight to the page content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <Sidebar businessName={data.businessName} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <MobileTopBar businessName={data.businessName} alerts={data.alerts} />
        <DesktopTopHeader ownerName={data.ownerName} alerts={data.alerts} />
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-x-hidden outline-none bg-background pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </main>
        <BottomNav />
      </div>
      {/* Inside the authenticated shell on purpose: the assistant drives this
          page as the owner, so it exists only where the owner is signed in —
          and only for a business it is switched on for. The routes refuse
          independently; this just avoids offering a button that would fail. */}
      {data.assistantEnabled && <AssistantPanel />}
    </div>
  );
}
