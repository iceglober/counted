"use client";

import { useState, useEffect, useImperativeHandle, forwardRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Star } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { api } from "@/lib/client-api";

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
        // Just drop the tab locally — navigation after a delete is the parent's
        // job (dashboard-page onDashboardDelete). The old `/${projectId}` push
        // pointed at a dead route and 404'd.
        setDashboards((prev) => sortDashboards(prev.filter((d) => d.id !== id)));
      },
      setDefault(id: string) {
        setDashboards((prev) => sortDashboards(prev.map((d) => ({ ...d, isDefault: d.id === id }))));
      },
    }));

    const [menuOpen, setMenuOpen] = useState(false);

    async function createDashboard(template: "blank" | "default" | "agent") {
      setMenuOpen(false);
      try {
        const dashboard = await api<{ id: string; name: string }>("/api/v0/dashboards", {
          method: "POST",
          body: { projectId, slug: `dash-${Date.now()}`, template },
        });
        setDashboards((prev) => sortDashboards([...prev, { id: dashboard.id, name: dashboard.name, isDefault: false }]));
        router.push(`/dashboards?dashboard=${dashboard.id}`);
      } catch {
        /* api() surfaced the error */
      }
    }

    return (
      <div className="flex items-center gap-1 mb-6">
        {dashboards.map((d) => (
          <Link
            key={d.id}
            href={`/dashboards?dashboard=${d.id}`}
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

        <div className="relative">
          <ActionButton
            label="New dashboard"
            onClick={() => setMenuOpen((o) => !o)}
            icon={<Plus className="w-3.5 h-3.5" />}
            className="p-1 text-text-tertiary hover:text-accent transition-colors"
          />
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute left-0 top-full mt-1 bg-surface-2 border border-border rounded-md shadow-lg z-50 py-1 min-w-[200px]">
                {[
                  { template: "blank" as const, title: "Blank", desc: "Start from scratch" },
                  { template: "default" as const, title: "Product metrics", desc: "Traffic, events, breakdowns" },
                  { template: "agent" as const, title: "Agent eval", desc: "Tool use, outcomes, file edits" },
                ].map((t) => (
                  <button
                    key={t.template}
                    onClick={() => createDashboard(t.template)}
                    className="w-full text-left px-3 py-1.5 hover:bg-surface-3 transition-colors"
                  >
                    <div className="text-xs text-text-primary">{t.title}</div>
                    <div className="text-[10px] text-text-tertiary">{t.desc}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  },
);
