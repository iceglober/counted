"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useProjects } from "@/components/dashboard/dashboard-shell";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

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
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 rounded-lg border border-border p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-16 text-text-tertiary">
          <p className="text-sm">No events yet for this project.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Session</TableHead>
                <TableHead>OS</TableHead>
                <TableHead>Locale</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Props</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Link href="/projects" className="text-xs text-accent hover:text-accent-hover transition-colors">
                      {event.project_name ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium text-text-primary">{event.event_name}</TableCell>
                  <TableCell className="font-mono text-xs">{event.session_id}</TableCell>
                  <TableCell>{event.os_name ?? "—"}</TableCell>
                  <TableCell>{event.locale ?? "—"}</TableCell>
                  <TableCell className="text-text-tertiary text-xs">{new Date(event.timestamp).toLocaleString()}</TableCell>
                  <TableCell className="max-w-48 truncate font-mono text-xs text-text-tertiary">
                    {Object.keys(event.props).length > 0 ? JSON.stringify(event.props) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
