import type { TimeSeriesData } from "@/lib/mock-data";

export function AreaChart({ title, data }: { title: string; data: TimeSeriesData }) {
  const w = 480;
  const h = 160;
  const pt = 8;
  const pb = 24;
  const px = 0;
  const cw = w - px * 2;
  const ch = h - pt - pb;

  const min = Math.min(...data.values);
  const max = Math.max(...data.values);
  const range = max - min || 1;

  const points = data.values.map((v, i) => ({
    x: px + (i / (data.values.length - 1)) * cw,
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

  const labelIndices: number[] = [];
  const step = Math.ceil(data.labels.length / 6);
  for (let i = 0; i < data.labels.length; i += step) labelIndices.push(i);

  return (
    <div className="bg-surface-1 border border-border rounded-lg p-5 hover:border-border-hover transition-colors">
      <div className="text-xs text-text-secondary uppercase tracking-wider mb-4">{title}</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={px}
            x2={px + cw}
            y1={pt + ch * (1 - f)}
            y2={pt + ch * (1 - f)}
            stroke="var(--color-border)"
            strokeWidth="0.5"
          />
        ))}

        <path d={fillPath} fill={`url(#${gradientId})`} />
        <path d={linePath} fill="none" stroke="var(--color-accent)" strokeWidth="2" />

        {/* X-axis labels */}
        {labelIndices.map((i) => (
          <text
            key={i}
            x={points[i].x}
            y={h - 4}
            textAnchor="middle"
            className="fill-text-tertiary"
            style={{ fontSize: 10, fontFamily: "var(--font-sans)" }}
          >
            {data.labels[i]}
          </text>
        ))}
      </svg>
    </div>
  );
}
