import type { MetricData } from "@/lib/types";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <div className="w-20 h-7" />;

  const w = 80;
  const h = 28;
  const pad = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => ({
    x: pad + (i / (data.length - 1)) * (w - pad * 2),
    y: pad + (1 - (v - min) / range) * (h - pad * 2),
  }));

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[Math.max(0, i - 2)];
    const p1 = points[i - 1];
    const p2 = points[i];
    const p3 = points[Math.min(points.length - 1, i + 1)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  const trending = data[data.length - 1] >= data[0];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-20 h-7" preserveAspectRatio="none">
      <path
        d={path}
        fill="none"
        stroke={trending ? "var(--color-success)" : "var(--color-error)"}
        strokeWidth="1.5"
        opacity="0.8"
      />
    </svg>
  );
}

export function MetricCard({ title, data }: { title: string; data: MetricData }) {
  const positive = data.trend >= 0;
  const hasTrend = data.trend !== 0;

  return (
    <div className="w-full bg-surface-1 border border-border rounded-lg p-5 hover:border-border-hover transition-colors">
      <div className="text-xs text-text-secondary uppercase tracking-wider">{title}</div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="text-2xl font-semibold tracking-tight tabular-nums">{data.value}</div>
        <Sparkline data={data.sparkline} />
      </div>
      {hasTrend ? (
        <div className="mt-2.5 flex items-center gap-1">
          {positive ? (
            <ArrowUpRight className="w-3.5 h-3.5 text-success" />
          ) : (
            <ArrowDownRight className="w-3.5 h-3.5 text-error" />
          )}
          <span className={`text-xs font-medium tabular-nums ${positive ? "text-success" : "text-error"}`}>
            {positive ? "+" : ""}{data.trend}%
          </span>
          <span className="text-xs text-text-tertiary ml-1">vs prev period</span>
        </div>
      ) : (
        <div className="mt-2.5">
          <span className="text-xs text-text-tertiary">No prior data for comparison</span>
        </div>
      )}
    </div>
  );
}
