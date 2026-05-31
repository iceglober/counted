"use client";

import { useState, useEffect, useImperativeHandle, forwardRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Star } from "lucide-react";
import { ActionButton } from "@/components/action-button";

type DashboardTab = {
  id: string;
  name: string;
  isDefault?: boolean;
};

export type DashboardTabsRef = {
  updateName: (id: string, name: string) => void;
  remove: (id: string) => void;
  setDefault: (id: string) => void;
};

type Props = {
  dashboards: DashboardTab[];
  activeDashboardId: string | null;
  projectId: string;
};

function sortDashboards(dashboards: DashboardTab[]): DashboardTab[] {
  return [...dashboards].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return 0;
  });
}

export const DashboardTabs = forwardRef<DashboardTabsRef, Props>(
  function DashboardTabs({ dashboards: initialDashboards, activeDashboardId, projectId }, ref) {
    const router = useRouter();
    const [dashboards, setDashboards] = useState(() => sortDashboards(initialDashboards));

    useEffect(() => setDashboards(sortDashboards(initialDashboards)), [initialDashboards]);

    useImperativeHandle(ref, () => ({
      updateName(id: string, name: string) {
        setDashboards((prev) => sortDashboards(prev.map((d) => d.id === id ? { ...d, name } : d)));
      },
      remove(id: string) {
        setDashboards((prev) => sortDashboards(prev.filter((d) => d.id !== id)));
        if (id === activeDashboardId) {
          router.push(`/${projectId}`);
          router.refresh();
        }
      },
      setDefault(id: string) {
        setDashboards((prev) => sortDashboards(prev.map((d) => ({ ...d, isDefault: d.id === id }))));
      },
    }));

    async function createDashboard() {
      const res = await fetch("/api/v0/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name: "Untitled", slug: `dash-${Date.now()}` }),
      });
      if (res.ok) {
        const dashboard = await res.json();
        setDashboards((prev) => sortDashboards([...prev, { id: dashboard.id, name: dashboard.name, isDefault: false }]));
        router.push(`/${projectId}?dashboard=${dashboard.id}`);
      }
    }

    return (
      <div className="flex items-center gap-1 mb-6">
        {dashboards.map((d) => (
          <Link
            key={d.id}
            href={`/${projectId}?dashboard=${d.id}`}
            className={`flex items-center gap-1 px-3 py-1 text-xs rounded-full transition-colors ${
              d.id === activeDashboardId
                ? "bg-accent/15 text-accent font-medium"
                : "text-text-tertiary hover:text-text-primary hover:bg-surface-2"
            }`}
          >
            {d.isDefault && <Star className="w-2.5 h-2.5 fill-current" />}
            {d.name}
          </Link>
        ))}

        <ActionButton
          label="New dashboard"
          onClick={createDashboard}
          icon={<Plus className="w-3.5 h-3.5" />}
          className="p-1 text-text-tertiary hover:text-accent transition-colors"
        />
      </div>
    );
  },
);
