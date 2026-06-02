"use client";

import { useEffect, useState } from "react";

/**
 * Muted "N events · 24h" indicator shown next to the dashboard title. Polls the
 * project's event count over the last 24 hours — a quiet, always-on signal that
 * data is flowing (replaces the old dismissible "Agent connected" bar).
 */
export function EventPulse({ projectId }: { projectId: string }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/v0/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            query: { measure: "count" },
            timeRange: { type: "relative", value: 24, unit: "hours" },
          }),
        });
        if (!res.ok || !alive) return;
        const { data } = await res.json();
        setCount(Number(data?.[0]?.value ?? 0));
      } catch {
        /* ignore — purely informational */
      }
    };
    poll();
    const id = setInterval(poll, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [projectId]);

  if (count === null) return null;

  return (
    <span className="text-xs text-text-tertiary tabular-nums whitespace-nowrap" title="Events received in the last 24 hours">
      {count.toLocaleString()} event{count !== 1 ? "s" : ""} · 24h
    </span>
  );
}
