import type { RetentionData } from "@/lib/types";

function cellColor(pct: number): string {
  if (pct >= 80) return "bg-accent/70";
  if (pct >= 60) return "bg-accent/55";
  if (pct >= 40) return "bg-accent/40";
  if (pct >= 20) return "bg-accent/25";
  if (pct > 0) return "bg-accent/12";
  return "bg-surface-2";
}

export function Retention({ title, data }: { title: string; data: RetentionData }) {
  if (data.cohorts.length === 0) {
    return (
      <div className="w-full bg-surface-1 border border-border rounded-lg p-5">
        <div className="text-xs text-text-secondary uppercase tracking-wider mb-3">{title}</div>
        <div className="h-32 flex items-center justify-center text-text-tertiary text-sm">No data yet</div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-surface-1 border border-border rounded-lg p-5 hover:border-border-hover transition-colors">
      <div className="text-xs text-text-secondary uppercase tracking-wider mb-4 shrink-0">{title}</div>
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left text-text-tertiary font-normal pb-2 pr-3 whitespace-nowrap">Cohort</th>
              <th className="text-right text-text-tertiary font-normal pb-2 pr-3 whitespace-nowrap">Users</th>
              {data.periods.map((p) => (
                <th key={p} className="text-center text-text-tertiary font-normal pb-2 px-1 whitespace-nowrap">{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.cohorts.map((cohort, ri) => (
              <tr key={cohort.label}>
                <td className="text-text-primary pr-3 py-1 whitespace-nowrap">{cohort.label}</td>
                <td className="text-text-secondary tabular-nums text-right pr-3 py-1">{cohort.size}</td>
                {data.periods.map((_, i) => {
                  const pct = cohort.retention[i];
                  if (pct === undefined) {
                    return <td key={i} className="px-1 py-1" />;
                  }
                  return (
                    <td key={i} className="px-1 py-1">
                      <div
                        className={`rounded px-2 py-1 text-center tabular-nums animate-grow-cell ${cellColor(pct)} ${pct > 0 ? "text-text-primary" : "text-text-tertiary"}`}
                        style={{ animationDelay: `${(ri + i) * 35}ms` }}
                      >
                        {pct}%
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
