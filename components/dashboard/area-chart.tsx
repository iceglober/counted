"use client";

import { useState, useRef, useEffect } from "react";
import type { TimeSeriesData } from "@/lib/types";

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function AreaChart({ title, data }: { title: string; data: TimeSeriesData }) {
  const [rawHoverIndex, setHoverIndex] = useState<number | null>(null);
  const hoverIndex = rawHoverIndex !== null && rawHoverIndex < data.values.length ? rawHoverIndex : null;

  // Size the chart to its container so it fills the card exactly (no overflow,
  // no distortion) regardless of the grid cell's fixed height.
  const plotRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 480, h: 180 });
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const update = () => setDims({ w: el.clientWidth || 480, h: el.clientHeight || 180 });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (data.values.length < 2) {
    return (
      <div className="h-full bg-surface-1 border border-border rounded-lg p-5">
        <div className="text-xs text-text-secondary uppercase tracking-wider mb-3">{title}</div>
        <div className="h-40 flex items-center justify-center text-text-tertiary text-sm">No data yet</div>
      </div>
    );
  }

  const w = dims.w;
  const h = dims.h;
  const pt = 12;
  const pb = 28;
  const pl = 40;
  const pr = 8;
  const cw = w - pl - pr;
  const ch = h - pt - pb;

  const min = 0;
  const max = Math.max(...data.values) || 1;
  const range = max - min || 1;

  const points = data.values.map((v, i) => ({
    x: pl + (i / (data.values.length - 1)) * cw,
    y: pt + (1 - (v - min) / range) * ch,
  }));

  let linePath = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[Math.max(0, i - 2)];
    const p1 = points[i - 1];
    const p2 = points[i];
    const p3 = points[Math.min(points.length - 1, i + 1)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    linePath += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  const fillPath = `${linePath} L ${points[points.length - 1].x} ${pt + ch} L ${points[0].x} ${pt + ch} Z`;
  const gradientId = `fill-${title.replace(/\s/g, "-")}`;

  // Y-axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: pt + ch * (1 - f),
    label: fmt(Math.round(min + range * f)),
  }));

  // X-axis labels
  const labelIndices: number[] = [];
  const step = Math.ceil(data.labels.length / 6);
  for (let i = 0; i < data.labels.length; i += step) labelIndices.push(i);

  // Total for header
  const total = data.values.reduce((a, b) => a + b, 0);

  return (
    <div className="h-full flex flex-col bg-surface-1 border border-border rounded-lg p-5 overflow-hidden hover:border-border-hover transition-colors">
      <div className="flex items-baseline justify-between mb-4 shrink-0">
        <div className="text-xs text-text-secondary uppercase tracking-wider">{title}</div>
        <div className="text-sm font-semibold tabular-nums">{fmt(total)}</div>
      </div>
      <div ref={plotRef} className="flex-1 min-h-0">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-full block"
        preserveAspectRatio="none"
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.32" />
            <stop offset="55%" stopColor="var(--color-accent)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid lines + Y labels */}
        {yTicks.map((tick, i) => (
          <g key={i}>
            <line
              x1={pl}
              x2={pl + cw}
              y1={tick.y}
              y2={tick.y}
              stroke="var(--color-border)"
              strokeWidth="0.5"
              strokeDasharray={i === 0 ? "none" : "2 4"}
            />
            <text
              x={pl - 6}
              y={tick.y + 3}
              textAnchor="end"
              className="fill-text-tertiary"
              style={{ fontSize: 9, fontFamily: "var(--font-sans)" }}
            >
              {tick.label}
            </text>
          </g>
        ))}

        <path d={fillPath} fill={`url(#${gradientId})`} className="animate-fade" />
        <path
          d={linePath}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          className="animate-draw"
          style={{ strokeDasharray: 1 }}
        />

        {/* Hover targets */}
        {points.map((p, i) => (
          <g key={i} onMouseEnter={() => setHoverIndex(i)}>
            <rect
              x={p.x - cw / data.values.length / 2}
              y={0}
              width={cw / data.values.length}
              height={h}
              fill="transparent"
            />
          </g>
        ))}

        {/* Hover state — rendered above everything */}
        {hoverIndex !== null && (
          <g style={{ pointerEvents: "none" }}>
            {/* Vertical hairline, full chart height */}
            <line
              x1={points[hoverIndex].x}
              x2={points[hoverIndex].x}
              y1={pt}
              y2={pt + ch}
              stroke="var(--color-accent)"
              strokeWidth="1"
              opacity="0.4"
            />

            {/* Dot on the line — soft halo + pop on appear */}
            <g style={{ transformBox: "fill-box", transformOrigin: "center" }} className="animate-grow-cell">
              <circle cx={points[hoverIndex].x} cy={points[hoverIndex].y} r="8" fill="var(--color-accent)" opacity="0.16" />
              <circle cx={points[hoverIndex].x} cy={points[hoverIndex].y} r="3.5" fill="var(--color-accent)" />
              <circle cx={points[hoverIndex].x} cy={points[hoverIndex].y} r="1.5" fill="var(--color-surface-1)" />
            </g>

            {/* Value — flip sides near the right edge */}
            {(() => {
              const nearRight = points[hoverIndex].x > w - 50;
              return (
                <text
                  x={points[hoverIndex].x + (nearRight ? -6 : 6)}
                  y={Math.max(points[hoverIndex].y - 4, 12)}
                  textAnchor={nearRight ? "end" : "start"}
                  style={{ fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "-0.02em" }}
                  className="fill-text-primary"
                >
                  {fmt(data.values[hoverIndex])}
                </text>
              );
            })()}

            {/* Date — just above the axis line */}
            <text
              x={points[hoverIndex].x}
              y={pt + ch + 12}
              textAnchor="middle"
              style={{ fontSize: 9, fontWeight: 600, fontFamily: "var(--font-sans)" }}
              className="fill-accent"
            >
              {data.labels[hoverIndex]}
            </text>
          </g>
        )}

        {/* X-axis labels — hide when near hover */}
        {labelIndices.map((i) => {
          if (hoverIndex !== null && Math.abs(points[i].x - points[hoverIndex].x) < 30) return null;
          return (
            <text
              key={i}
              x={points[i].x}
              y={h - 6}
              textAnchor="middle"
              className="fill-text-tertiary"
              style={{ fontSize: 9, fontFamily: "var(--font-sans)" }}
            >
              {data.labels[i]}
            </text>
          );
        })}
      </svg>
      </div>
    </div>
  );
}
