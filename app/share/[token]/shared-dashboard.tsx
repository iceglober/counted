"use client";

import type { Insight, MetricData, TimeSeriesData, BreakdownItem } from "@/lib/types";
import { MetricCard } from "@/components/dashboard/metric-card";
import { AreaChart } from "@/components/dashboard/area-chart";
import { Breakdown } from "@/components/dashboard/breakdown";

function InsightRenderer({ insight }: { insight: Insight }) {
  if (!insight.data) return null;

  switch (insight.type) {
    case "metric": {
      const m = insight.data as MetricData;
      return <MetricCard title={insight.title} data={{ value: m?.value ?? "0", trend: m?.trend ?? 0, sparkline: m?.sparkline ?? [] }} />;
    }
    case "timeseries": {
      const ts = insight.data as TimeSeriesData;
      return (
        <AreaChart
          title={insight.title}
          data={{ labels: ts?.labels ?? [], values: ts?.values ?? [], series: ts?.series }}
          bucket={insight.query?.timeBucket}
          summary={insight.summary}
        />
      );
    }
    case "breakdown":
      return <Breakdown title={insight.title} items={(insight.data as { items?: BreakdownItem[] })?.items ?? []} />;
  }
}

export function SharedDashboard({ insights }: { insights: Insight[] }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {insights.map((insight) => (
        <div key={insight.id} className="w-full" style={{ gridColumn: `span ${Math.min(insight.span, 3)}` }}>
          <InsightRenderer insight={insight} />
        </div>
      ))}
      {insights.length === 0 && (
        <div className="col-span-3 text-center py-16 text-text-tertiary text-sm">
          This dashboard has no insights yet.
        </div>
      )}
    </div>
  );
}
