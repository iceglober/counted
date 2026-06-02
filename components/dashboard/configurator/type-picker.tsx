"use client";

import type { InsightType } from "@/lib/types";

const TYPES: { value: InsightType; label: string }[] = [
  { value: "metric", label: "Metric" },
  { value: "timeseries", label: "Time series" },
  { value: "breakdown", label: "Breakdown" },
  { value: "funnel", label: "Funnel" },
  { value: "retention", label: "Retention" },
];

type Props = {
  value: InsightType;
  onChange: (value: InsightType) => void;
};

// Segmented control. Plain buttons (role=button) rather than a Radix ToggleGroup
// (which exposes radio semantics) — the active style already matches the
// library's ToggleGroupItem token language.
export function TypePicker({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {TYPES.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
            value === t.value
              ? "border-accent/30 bg-accent/15 text-accent"
              : "border-transparent bg-surface-2 text-text-secondary hover:text-text-primary"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
