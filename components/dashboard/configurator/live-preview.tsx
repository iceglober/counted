"use client";

import type { Insight, MetricData, TimeSeriesData, BreakdownItem, FunnelData } from "@/lib/types";
import { MetricCard } from "../metric-card";
import { AreaChart } from "../area-chart";
import { Breakdown } from "../breakdown";
import { Funnel } from "../funnel";

type Props = {
  type: "metric" | "timeseries" | "breakdown" | "funnel";
  data: Insight["data"] | null;
  loading: boolean;
  error: string | null;
  incomplete: boolean;
  meta?: { totalEvents: number; executionMs: number };
};

export function LivePreview({ type, data, loading, error, incomplete, meta }: Props) {
  if (incomplete) {
    return (
      <div className="py-6 text-center text-xs text-text-tertiary">
        Complete the configuration to see results
      </div>
    );
  }

  if (loading) {
    return (
      <div className="py-6 flex justify-center">
        <div className="flex gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-accent/40 animate-pulse" />
          <div className="w-1.5 h-1.5 rounded-full bg-accent/40 animate-pulse" style={{ animationDelay: "150ms" }} />
          <div className="w-1.5 h-1.5 rounded-full bg-accent/40 animate-pulse" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-6 text-center text-xs text-error">
        Query failed
      </div>
    );
  }

  if (!data) return null;

  const isEmpty = type === "metric"
    ? (data as MetricData)?.value === "0"
    : type === "timeseries"
      ? ((data as TimeSeriesData)?.values?.length ?? 0) === 0
      : type === "funnel"
        ? ((data as FunnelData)?.steps?.length ?? 0) === 0
        : ((data as { items: BreakdownItem[] })?.items?.length ?? 0) === 0;

  if (isEmpty) {
    return (
      <div className="py-6 text-center text-xs text-text-tertiary">
        No events match this query
      </div>
    );
  }

  return (
    <div>
      {type === "metric" && <MetricCard title="" data={data as MetricData} />}
      {type === "timeseries" && <AreaChart title="" data={data as TimeSeriesData} />}
      {type === "breakdown" && <Breakdown title="" items={(data as { items: BreakdownItem[] }).items ?? []} />}
      {type === "funnel" && <Funnel title="" steps={(data as FunnelData).steps ?? []} />}
      {meta && (
        <div className="mt-2 text-xs text-text-tertiary text-right tabular-nums">
          {meta.totalEvents} row{meta.totalEvents !== 1 ? "s" : ""} · {meta.executionMs}ms
        </div>
      )}
    </div>
  );
}
