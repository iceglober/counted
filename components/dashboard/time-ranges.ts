import type { TimeRange } from "@/lib/types";

// Single source of truth for dashboard time ranges, shared by the server render
// (app/(app)/dashboards/page.tsx) and the client picker (dashboard-view) so the
// URL ?range= code, the label, and the query window can't drift. Longer ranges
// (months) are needed to view imported history and long retention windows.
export type RangeOption = { label: string; code: string; range: TimeRange };

export const TIME_RANGES: RangeOption[] = [
  { label: "Last 24 hours", code: "24h", range: { type: "relative", value: 24, unit: "hours" } },
  { label: "Last 7 days", code: "7d", range: { type: "relative", value: 7, unit: "days" } },
  { label: "Last 30 days", code: "30d", range: { type: "relative", value: 30, unit: "days" } },
  { label: "Last 90 days", code: "90d", range: { type: "relative", value: 90, unit: "days" } },
  { label: "Last 6 months", code: "6mo", range: { type: "relative", value: 6, unit: "months" } },
  { label: "Last 12 months", code: "12mo", range: { type: "relative", value: 12, unit: "months" } },
  { label: "All time", code: "all", range: { type: "relative", value: 120, unit: "months" } },
];

export const DEFAULT_RANGE_CODE = "30d";

export function rangeByCode(code: string | undefined): RangeOption {
  return (
    TIME_RANGES.find((r) => r.code === code) ??
    TIME_RANGES.find((r) => r.code === DEFAULT_RANGE_CODE)!
  );
}

export function rangeByLabel(label: string): RangeOption {
  return TIME_RANGES.find((r) => r.label === label) ?? rangeByCode(DEFAULT_RANGE_CODE);
}
