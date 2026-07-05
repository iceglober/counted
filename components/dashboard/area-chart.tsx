"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import type { TimeSeriesData, SummaryStat } from "@/lib/types";

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

// Line colors per series; the first matches the classic single-series accent.
const SERIES_COLORS = [
  "var(--color-accent)",
  "#007700",
  "#CC0000",
  "#996600",
  "#660099",
];

const SUMMARY_OPTIONS: { value: SummaryStat; label: string }[] = [
  { value: "total", label: "Total" },
  { value: "average", label: "Average" },
  { value: "peak", label: "Peak" },
];

function summarize(values: number[], stat: SummaryStat): number {
  if (values.length === 0) return 0;
  const total = values.reduce((a, b) => a + b, 0);
  if (stat === "average") return total / values.length;
  if (stat === "peak") return Math.max(...values);
  return total;
}

// "avg/day" etc. — the per-bucket unit makes "Average" unambiguous.
function summarySuffix(stat: SummaryStat, bucket?: string): string | null {
  if (stat === "average") return `avg/${bucket ?? "day"}`;
  if (stat === "peak") return "peak";
  return null;
}

function curvePath(points: { x: number; y: number }[]): string {
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
  return path;
}

type Props = {
  title: string;
  data: TimeSeriesData;
  /** Bucket granularity — labels the average stat ("avg/day"). */
  bucket?: "hour" | "day" | "week" | "month";
  /** Which summary the header shows. Undefined = total. */
  summary?: SummaryStat;
  /** When provided, the header stat becomes a selector and changes persist. */
  onSummaryChange?: (stat: SummaryStat) => void;
};

export function AreaChart({ title, data, bucket, summary = "total", onSummaryChange }: Props) {
  const [rawHoverIndex, setHoverIndex] = useState<number | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const hoverIndex = rawHoverIndex !== null && rawHoverIndex < data.labels.length ? rawHoverIndex : null;

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

  // Single-series data has no `series`; normalise so rendering has one shape.
  const series = data.series?.length
    ? data.series
    : [{ label: title || "Value", values: data.values }];
  const multi = series.length > 1;

  if (data.labels.length < 2) {
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
  const max = Math.max(...series.flatMap((s) => s.values)) || 1;
  const range = max - min || 1;

  const n = data.labels.length;
  const xOf = (i: number) => pl + (i / (n - 1)) * cw;
  const yOf = (v: number) => pt + (1 - (v - min) / range) * ch;
  const seriesPoints = series.map((s) => s.values.map((v, i) => ({ x: xOf(i), y: yOf(v) })));

  const gradientId = `fill-${title.replace(/\s/g, "-")}`;

  // Y-axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: pt + ch * (1 - f),
    label: fmt(Math.round(min + range * f)),
  }));

  // X-axis labels
  const labelIndices: number[] = [];
  const step = Math.ceil(n / 6);
  for (let i = 0; i < n; i += step) labelIndices.push(i);

  const suffix = summarySuffix(summary, bucket);

  const summaryMenu = onSummaryChange && summaryOpen && (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setSummaryOpen(false)} />
      <div className="absolute right-0 top-full mt-1 bg-surface-2 border border-border rounded-md shadow-lg z-50 py-1 min-w-[150px]">
        {SUMMARY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => { onSummaryChange(opt.value); setSummaryOpen(false); }}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${
              summary === opt.value
                ? "text-accent bg-accent/8"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-3"
            }`}
          >
            <span className="flex-1">{opt.label}</span>
            {!multi && (
              <span className="text-text-tertiary tabular-nums">{fmt(summarize(series[0].values, opt.value))}</span>
            )}
            {summary === opt.value && <Check className="w-3 h-3" />}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className="h-full flex flex-col bg-surface-1 border border-border rounded-lg p-5 overflow-hidden hover:border-border-hover transition-colors">
      <div className="flex items-baseline justify-between gap-3 mb-4 shrink-0">
        <div className="text-xs text-text-secondary uppercase tracking-wider truncate">{title}</div>
        <div className="flex items-baseline gap-3 min-w-0">
          {/* Legend — each series gets its dot, name, and the chosen summary stat. */}
          {multi && (
            <div className="flex items-baseline gap-3 overflow-hidden">
              {series.map((s, si) => (
                <div key={si} className="flex items-baseline gap-1.5 text-xs whitespace-nowrap">
                  <span
                    className="w-2 h-2 rounded-full self-center shrink-0"
                    style={{ background: SERIES_COLORS[si % SERIES_COLORS.length] }}
                  />
                  <span className="text-text-tertiary truncate max-w-28">{s.label}</span>
                  <span className="font-semibold tabular-nums text-text-primary">
                    {fmt(summarize(s.values, summary))}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="relative shrink-0">
            <button
              onClick={onSummaryChange ? () => setSummaryOpen(!summaryOpen) : undefined}
              className={`group/stat flex items-baseline gap-1 ${onSummaryChange ? "cursor-pointer rounded hover:bg-surface-2 -mx-1 px-1 transition-colors" : "cursor-default"}`}
              aria-label="Change summary statistic"
            >
              {multi ? (
                <span className="text-xs text-text-secondary">
                  {SUMMARY_OPTIONS.find((o) => o.value === summary)?.label}
                </span>
              ) : (
                <>
                  <span className="text-sm font-semibold tabular-nums">{fmt(summarize(series[0].values, summary))}</span>
                  {suffix && <span className="text-[10px] text-text-tertiary">{suffix}</span>}
                </>
              )}
              {onSummaryChange && (
                <ChevronDown className={`w-3 h-3 self-center text-text-tertiary opacity-0 group-hover/stat:opacity-100 transition-opacity ${summaryOpen ? "opacity-100 rotate-180" : ""}`} />
              )}
            </button>
            {summaryMenu}
          </div>
        </div>
      </div>
      <div ref={plotRef} className="relative flex-1 min-h-0">
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

        {/* Area fill only for a single series — stacked fills would muddy the lines. */}
        {!multi && seriesPoints[0].length > 0 && (
          <path
            d={`${curvePath(seriesPoints[0])} L ${seriesPoints[0][seriesPoints[0].length - 1].x} ${pt + ch} L ${seriesPoints[0][0].x} ${pt + ch} Z`}
            fill={`url(#${gradientId})`}
            className="animate-fade"
          />
        )}
        {seriesPoints.map((pts, si) => (
          pts.length > 1 && (
            <path
              key={si}
              d={curvePath(pts)}
              fill="none"
              stroke={SERIES_COLORS[si % SERIES_COLORS.length]}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              className="animate-draw"
              style={{ strokeDasharray: 1 }}
            />
          )
        ))}

        {/* Hover targets */}
        {data.labels.map((_, i) => (
          <rect
            key={i}
            x={xOf(i) - cw / n / 2}
            y={0}
            width={cw / n}
            height={h}
            fill="transparent"
            onMouseEnter={() => setHoverIndex(i)}
          />
        ))}

        {/* Hover state — rendered above everything */}
        {hoverIndex !== null && (
          <g style={{ pointerEvents: "none" }}>
            {/* Vertical hairline, full chart height */}
            <line
              x1={xOf(hoverIndex)}
              x2={xOf(hoverIndex)}
              y1={pt}
              y2={pt + ch}
              stroke="var(--color-accent)"
              strokeWidth="1"
              opacity="0.4"
            />

            {/* Dot on each line — soft halo + pop on appear */}
            {seriesPoints.map((pts, si) => pts[hoverIndex] && (
              <g key={si} style={{ transformBox: "fill-box", transformOrigin: "center" }} className="animate-grow-cell">
                <circle cx={pts[hoverIndex].x} cy={pts[hoverIndex].y} r="8" fill={SERIES_COLORS[si % SERIES_COLORS.length]} opacity="0.16" />
                <circle cx={pts[hoverIndex].x} cy={pts[hoverIndex].y} r="3.5" fill={SERIES_COLORS[si % SERIES_COLORS.length]} />
                <circle cx={pts[hoverIndex].x} cy={pts[hoverIndex].y} r="1.5" fill="var(--color-surface-1)" />
              </g>
            ))}

            {/* Single series: value floats by the dot. Multi uses the HTML tooltip. */}
            {!multi && (() => {
              const nearRight = xOf(hoverIndex) > w - 50;
              return (
                <text
                  x={xOf(hoverIndex) + (nearRight ? -6 : 6)}
                  y={Math.max(seriesPoints[0][hoverIndex].y - 4, 12)}
                  textAnchor={nearRight ? "end" : "start"}
                  style={{ fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "-0.02em" }}
                  className="fill-text-primary"
                >
                  {fmt(series[0].values[hoverIndex])}
                </text>
              );
            })()}

            {/* Date — just above the axis line */}
            <text
              x={xOf(hoverIndex)}
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
          if (hoverIndex !== null && Math.abs(xOf(i) - xOf(hoverIndex)) < 30) return null;
          return (
            <text
              key={i}
              x={xOf(i)}
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

      {/* Multi-series tooltip — every series' value at the hovered bucket. */}
      {multi && hoverIndex !== null && (
        <div
          className="absolute top-1 z-10 pointer-events-none bg-surface-2/95 border border-border rounded-md shadow-lg px-2.5 py-1.5 space-y-0.5"
          style={xOf(hoverIndex) > w / 2 ? { right: w - xOf(hoverIndex) + 8 } : { left: xOf(hoverIndex) + 8 }}
        >
          {series.map((s, si) => (
            <div key={si} className="flex items-center gap-1.5 text-[11px] whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SERIES_COLORS[si % SERIES_COLORS.length] }} />
              <span className="text-text-tertiary">{s.label}</span>
              <span className="ml-auto pl-2 font-semibold tabular-nums text-text-primary">{fmt(s.values[hoverIndex] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
