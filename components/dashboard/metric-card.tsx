"use client";

import { useState, useEffect, useRef } from "react";
import type { MetricData } from "@/lib/types";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

// Count a number up from 0 on mount (easeOutCubic). Honours reduced-motion and
// preserves the value's decimal places + thousands separators.
function useCountUp(target: number, decimals: number, duration = 850): number {
  const [val, setVal] = useState(target);
  const ref = useRef(target);
  ref.current = target;
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setVal(ref.current);
      return;
    }
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(ref.current * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function MetricValue({ value }: { value: string }) {
  const numeric = Number(value.replace(/,/g, ""));
  const countable = Number.isFinite(numeric) && !/[a-z%$]/i.test(value);
  const decimals = (value.split(".")[1] || "").length;
  const counted = useCountUp(countable ? numeric : 0, decimals);

  if (!countable) {
    return <span className="animate-rise">{value}</span>;
  }
  return (
    <span className="tabular-nums">
      {counted.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
    </span>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return <div className="w-20 h-7" />;

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
  const stroke = trending ? "var(--color-success)" : "var(--color-error)";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-20 h-7" preserveAspectRatio="none">
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
        pathLength={1}
        className="animate-draw"
        style={{ strokeDasharray: 1 }}
      />
    </svg>
  );
}

export function MetricCard({ title, data }: { title: string; data: MetricData }) {
  if (!data) return null;
  const positive = (data.trend ?? 0) >= 0;
  const hasTrend = (data.trend ?? 0) !== 0;

  return (
    <div className="w-full bg-surface-1 border border-border rounded-lg p-5 hover:border-border-hover transition-colors">
      <div className="text-xs text-text-secondary uppercase tracking-wider">{title}</div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="text-2xl font-semibold tracking-tight tabular-nums">
          <MetricValue value={data.value ?? "—"} />
        </div>
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
