import type { FunnelStep } from "@/lib/types";

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

export function Funnel({ title, steps }: { title: string; steps: FunnelStep[] }) {
  if (steps.length === 0) {
    return (
      <div className="w-full bg-surface-1 border border-border rounded-lg p-5">
        <div className="text-xs text-text-secondary uppercase tracking-wider mb-3">{title}</div>
        <div className="h-32 flex items-center justify-center text-text-tertiary text-sm">No data yet</div>
      </div>
    );
  }

  const maxValue = steps[0]?.value ?? 1;

  return (
    <div className="w-full h-full flex flex-col bg-surface-1 border border-border rounded-lg p-5 hover:border-border-hover transition-colors">
      <div className="text-xs text-text-secondary uppercase tracking-wider mb-4 shrink-0">{title}</div>
      <div className="space-y-2 flex-1 min-h-0 overflow-y-auto">
        {steps.map((step, i) => {
          const widthPct = maxValue > 0 ? (step.value / maxValue) * 100 : 0;
          const isFirst = i === 0;

          return (
            <div key={step.label}>
              <div className="flex items-center justify-between text-sm mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-tertiary tabular-nums w-4">{i + 1}</span>
                  <span className="text-text-primary text-xs">{step.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  {!isFirst && (
                    <span className={`text-xs tabular-nums ${step.rate >= 50 ? "text-success" : step.rate >= 20 ? "text-accent" : "text-error"}`}>
                      {step.rate}%
                    </span>
                  )}
                  <span className="text-text-secondary tabular-nums text-xs font-medium">{fmt(step.value)}</span>
                </div>
              </div>
              <div className="h-7 bg-surface-2 rounded-md overflow-hidden">
                <div
                  className="h-full origin-left rounded-md bg-gradient-to-r from-accent/35 to-accent/75 animate-grow-x"
                  style={{ width: `${widthPct}%`, animationDelay: `${i * 70}ms` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {steps.length >= 2 && (
        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs text-text-tertiary shrink-0">
          <span>Overall conversion</span>
          <span className="font-medium tabular-nums">
            {maxValue > 0 ? ((steps[steps.length - 1].value / maxValue) * 100).toFixed(1) : 0}%
          </span>
        </div>
      )}
    </div>
  );
}
