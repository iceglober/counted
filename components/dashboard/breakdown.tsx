import type { BreakdownItem } from "@/lib/mock-data";

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function Breakdown({ title, items }: { title: string; items: BreakdownItem[] }) {
  const max = Math.max(...items.map((i) => i.value));

  return (
    <div className="bg-surface-1 border border-border rounded-lg p-5 hover:border-border-hover transition-colors">
      <div className="text-xs text-text-secondary uppercase tracking-wider mb-4">{title}</div>
      <div className="space-y-2.5">
        {items.map((item) => {
          const pct = (item.value / max) * 100;
          return (
            <div key={item.label} className="group">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-text-primary font-mono text-xs">{item.label}</span>
                <span className="text-text-secondary tabular-nums text-xs">{fmt(item.value)}</span>
              </div>
              <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent/60 rounded-full group-hover:bg-accent/80 transition-colors"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
