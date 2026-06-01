"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DashboardTabs, type DashboardTabsRef } from "./dashboard-tabs";
import { DashboardView } from "./dashboard-view";
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
};

export function DashboardPage({ dashboards, activeDashboardId, activeDashboardName, isDefault: initialIsDefault, initialInsights, projectId, projectKey }: Props) {
  const tabsRef = useRef<DashboardTabsRef>(null);
  const router = useRouter();
  const [currentIsDefault, setCurrentIsDefault] = useState(initialIsDefault ?? false);

  useEffect(() => setCurrentIsDefault(initialIsDefault ?? false), [initialIsDefault]);

  async function setAsDefault() {
    if (!activeDashboardId) return;
    await fetch(`/api/v0/dashboards/${activeDashboardId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    setCurrentIsDefault(true);
    tabsRef.current?.setDefault(activeDashboardId);
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
        dashboardId={activeDashboardId}
        dashboardName={activeDashboardName}
        isDefault={currentIsDefault}
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
