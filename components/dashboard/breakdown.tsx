import type { BreakdownItem } from "@/lib/types";

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

export function Breakdown({ title, items = [] }: { title: string; items: BreakdownItem[] }) {
  if (items.length === 0) {
    return (
      <div className="w-full bg-surface-1 border border-border rounded-lg p-5">
        <div className="text-xs text-text-secondary uppercase tracking-wider mb-3">{title}</div>
        <div className="h-32 flex items-center justify-center text-text-tertiary text-sm">No data yet</div>
      </div>
    );
  }

  const max = Math.max(...items.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0);

  return (
    <div className="w-full bg-surface-1 border border-border rounded-lg p-5 hover:border-border-hover transition-colors">
      <div className="flex items-baseline justify-between mb-4">
        <div className="text-xs text-text-secondary uppercase tracking-wider">{title}</div>
        <div className="text-sm font-semibold tabular-nums">{fmt(total)}</div>
      </div>
      <div className="space-y-2.5">
        {items.map((item, i) => {
          const pct = total > 0 ? (item.value / total) * 100 : 0;
          const barPct = max > 0 ? (item.value / max) * 100 : 0;
          return (
            <div key={item.label} className="group">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-text-primary text-xs">{item.label ?? "unknown"}</span>
                <div className="flex items-center gap-2">
                  <span className="text-text-tertiary tabular-nums text-xs">{pct.toFixed(1)}%</span>
                  <span className="text-text-secondary tabular-nums text-xs font-medium">{fmt(item.value)}</span>
                </div>
              </div>
              <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                <div
                  className="h-full origin-left rounded-full bg-gradient-to-r from-accent/45 to-accent transition-[filter] duration-200 animate-grow-x group-hover:brightness-110"
                  style={{ width: `${barPct}%`, animationDelay: `${i * 55}ms` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
