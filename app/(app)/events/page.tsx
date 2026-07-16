"use client";

import { useState, useEffect, useRef, useCallback, Fragment } from "react";
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

const POLL_MS = 12_000;

function rowKey(r: EventRow): string {
  return `${r.timestamp}|${r.session_id}|${r.event_name}`;
}

export default function EventsPage() {
  const projects = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState("all");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [freshKeys, setFreshKeys] = useState<Set<string>>(new Set());
  const seenKeysRef = useRef<Set<string>>(new Set());

  const load = useCallback(
    async (showSpinner: boolean) => {
      const param = selectedProjectId === "all"
        ? projects.map((p) => `projectId=${p.id}`).join("&")
        : `projectId=${selectedProjectId}`;
      if (selectedProjectId === "all" && projects.length === 0) {
        setEvents([]);
        setLoading(false);
        return;
      }
      if (showSpinner) setLoading(true);
      try {
        const r = await fetch(`/api/v0/events-list?${param}`);
        const rows: EventRow[] = r.ok ? await r.json() : [];
        const projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));
        const mapped = rows.map((row) => ({ ...row, project_name: projectMap[row.project_id] }));

        // Highlight rows we haven't seen before (skip the very first load).
        if (seenKeysRef.current.size > 0) {
          const fresh = new Set<string>();
          for (const row of mapped) {
            const k = rowKey(row);
            if (!seenKeysRef.current.has(k)) fresh.add(k);
          }
          if (fresh.size > 0) {
            setFreshKeys(fresh);
            setTimeout(() => setFreshKeys(new Set()), 2500);
          }
        }
        seenKeysRef.current = new Set(mapped.map(rowKey));
        setEvents(mapped);
      } catch {
        if (showSpinner) setEvents([]);
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [selectedProjectId, projects],
  );

  // Reset when the project filter changes, then load.
  useEffect(() => {
    seenKeysRef.current = new Set();
    setExpanded(null);
    load(true);
  }, [selectedProjectId, projects, load]);

  // Auto-poll, paused while the tab is hidden.
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id == null) id = setInterval(() => load(false), POLL_MS);
    };
    const stop = () => {
      if (id != null) { clearInterval(id); id = null; }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { load(false); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            Events
            {!loading && (
              <span className="inline-flex items-center gap-1 text-[10px] font-normal text-text-tertiary uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                Live
              </span>
            )}
          </h1>
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
        <div className="rounded-lg border border-border px-6 py-12 text-center">
          <p className="text-sm text-text-secondary">
            No events yet{selectedProject ? ` for ${selectedProject.name}` : ""}.
          </p>
          <p className="text-sm text-text-tertiary mt-2">
            Install the SDK and send your first event to see it here.
          </p>
          <div className="mt-4 inline-block text-left">
            <pre className="text-xs font-mono text-text-secondary bg-surface-2 border border-border px-4 py-3 rounded-md overflow-x-auto">
{`import { Analytics } from "@counted/sdk";

const analytics = new Analytics({ projectKey: "<your client key>" });
analytics.track("page_view", { path: "/" });`}
            </pre>
          </div>
          <div className="mt-4">
            <Link href="/projects" className="text-xs text-accent hover:text-accent-hover transition-colors">
              Get your project key &amp; setup instructions &rarr;
            </Link>
          </div>
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
              {events.map((event) => {
                const key = rowKey(event);
                const isOpen = expanded === key;
                const hasProps = Object.keys(event.props).length > 0;
                return (
                  <Fragment key={key}>
                    <TableRow
                      onClick={() => hasProps && setExpanded(isOpen ? null : key)}
                      className={`${hasProps ? "cursor-pointer" : ""} ${freshKeys.has(key) ? "bg-accent/8" : ""} transition-colors`}
                    >
                      <TableCell>
                        <Link href="/projects" onClick={(e) => e.stopPropagation()} className="text-xs text-accent hover:text-accent-hover transition-colors">
                          {event.project_name ?? "—"}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium text-text-primary">{event.event_name}</TableCell>
                      <TableCell className="font-mono text-xs">{event.session_id}</TableCell>
                      <TableCell>{event.os_name ?? "—"}</TableCell>
                      <TableCell>{event.locale ?? "—"}</TableCell>
                      <TableCell className="text-text-tertiary text-xs">{new Date(event.timestamp).toLocaleString()}</TableCell>
                      <TableCell className="max-w-48 truncate font-mono text-xs text-text-tertiary">
                        {hasProps ? (isOpen ? "Hide" : JSON.stringify(event.props)) : "—"}
                      </TableCell>
                    </TableRow>
                    {isOpen && hasProps && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-surface-2/40">
                          <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-all p-2">
                            {JSON.stringify(event.props, null, 2)}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
