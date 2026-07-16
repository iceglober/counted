"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DashboardTabs, type DashboardTabsRef } from "./dashboard-tabs";
import { DashboardView } from "./dashboard-view";
import { api } from "@/lib/client-api";
import { toast } from "@/components/ui/sonner";
import type { Insight } from "@/lib/types";

type DashboardInfo = { id: string; name: string; isDefault?: boolean };

type Props = {
  dashboards: DashboardInfo[];
  activeDashboardId: string | null;
  activeDashboardName?: string;
  isDefault?: boolean;
  initialInsights: Insight[];
  projectId: string;
  projectKey?: string;
  shareToken?: string | null;
  compact?: boolean;
  initialRangeCode?: string;
};

export function DashboardPage({ dashboards, activeDashboardId, activeDashboardName, isDefault: initialIsDefault, initialInsights, projectId, projectKey, shareToken, compact, initialRangeCode }: Props) {
  const tabsRef = useRef<DashboardTabsRef>(null);
  const router = useRouter();
  const [currentIsDefault, setCurrentIsDefault] = useState(initialIsDefault ?? false);

  useEffect(() => setCurrentIsDefault(initialIsDefault ?? false), [initialIsDefault]);

  // Stripe checkout redirects back here with ?upgraded=true — confirm it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("upgraded") === "true") {
      toast.success("You're on Pro — thanks for upgrading!");
      url.searchParams.delete("upgraded");
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  async function setAsDefault() {
    if (!activeDashboardId) return;
    // Optimistic: flip locally, revert if the request fails.
    setCurrentIsDefault(true);
    tabsRef.current?.setDefault(activeDashboardId);
    try {
      await api(`/api/v0/dashboards/${activeDashboardId}`, { method: "PUT", body: { isDefault: true } });
      toast.success("Set as default dashboard");
    } catch {
      setCurrentIsDefault(false);
      router.refresh();
    }
  }

  return (
    <div className="flex-1 min-w-0">
      <DashboardTabs
        ref={tabsRef}
        dashboards={dashboards}
        activeDashboardId={activeDashboardId}
        projectId={projectId}
      />
      <DashboardView
        initialInsights={initialInsights}
        projectId={projectId}
        projectKey={projectKey}
        shareToken={shareToken}
        compact={compact}
        dashboardId={activeDashboardId}
        dashboardName={activeDashboardName}
        isDefault={currentIsDefault}
        initialRangeCode={initialRangeCode}
        onDashboardRename={(name) => {
          if (activeDashboardId) tabsRef.current?.updateName(activeDashboardId, name);
        }}
        onDashboardDelete={() => {
          if (activeDashboardId) tabsRef.current?.remove(activeDashboardId);
          const remaining = dashboards.filter((d) => d.id !== activeDashboardId);
          if (remaining.length > 0) {
            router.push(`/dashboards?dashboard=${remaining[0].id}`);
          } else {
            router.push(`/dashboards`);
          }
          router.refresh();
        }}
        onSetDefault={setAsDefault}
      />
    </div>
  );
}
