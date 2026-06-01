"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useProjects } from "@/components/dashboard/dashboard-shell";
import { Dropdown } from "@/components/dropdown";

type EventRow = {
  event_name: string;
  session_id: string;
  os_name: string | null;
  locale: string | null;
  timestamp: string;
  props: Record<string, unknown>;
  project_id: string;
  project_name?: string;
};

export default function EventsPage() {
  const projects = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState("all");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedProjectId) return;
    setLoading(true);
    const param = selectedProjectId === "all"
      ? projects.map((p) => `projectId=${p.id}`).join("&")
      : `projectId=${selectedProjectId}`;

    fetch(`/api/v0/events-list?${param}`)
      .then((r) => r.json())
      .then((rows: EventRow[]) => {
        const projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));
        setEvents(rows.map((r) => ({ ...r, project_name: projectMap[r.project_id] })));
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [selectedProjectId]);

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold">Events</h1>
          <p className="text-sm text-text-secondary mt-0.5">Last 100 events</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-tertiary">Project</span>
          <Dropdown
            value={selectedProjectId}
            options={[
              { value: "all", label: "All projects" },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
            onChange={setSelectedProjectId}
            className="w-48"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-text-tertiary text-sm">Loading...</div>
      ) : events.length === 0 ? (
        <div className="text-center py-16 text-text-tertiary">
          <p className="text-sm">No events yet for this project.</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-1 border-b border-border text-text-secondary text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3 font-medium">Project</th>
                <th className="text-left px-4 py-3 font-medium">Event</th>
                <th className="text-left px-4 py-3 font-medium">Session</th>
                <th className="text-left px-4 py-3 font-medium">OS</th>
                <th className="text-left px-4 py-3 font-medium">Locale</th>
                <th className="text-left px-4 py-3 font-medium">Time</th>
                <th className="text-left px-4 py-3 font-medium">Props</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event, i) => (
                <tr
                  key={i}
                  className="border-b border-border last:border-0 hover:bg-surface-1/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link href="/projects" className="text-xs text-accent hover:text-accent-hover transition-colors">
                      {event.project_name ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-text-primary">{event.event_name}</td>
                  <td className="px-4 py-3 text-text-secondary font-mono text-xs">{event.session_id}</td>
                  <td className="px-4 py-3 text-text-secondary">{event.os_name ?? "—"}</td>
                  <td className="px-4 py-3 text-text-secondary">{event.locale ?? "—"}</td>
                  <td className="px-4 py-3 text-text-tertiary text-xs">{new Date(event.timestamp).toLocaleString()}</td>
                  <td className="px-4 py-3 text-text-tertiary font-mono text-xs max-w-48 truncate">
                    {Object.keys(event.props).length > 0 ? JSON.stringify(event.props) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
