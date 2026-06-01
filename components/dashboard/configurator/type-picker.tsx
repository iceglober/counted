"use client";

const TYPES = [
  { value: "metric" as const, label: "Metric" },
  { value: "timeseries" as const, label: "Time series" },
  { value: "breakdown" as const, label: "Breakdown" },
  { value: "funnel" as const, label: "Funnel" },
];

type InsightType = "metric" | "timeseries" | "breakdown" | "funnel";

type Props = {
  value: InsightType;
  onChange: (value: InsightType) => void;
};

export function TypePicker({ value, onChange }: Props) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {TYPES.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
            value === t.value
              ? "bg-accent/15 text-accent border border-accent/30"
              : "bg-surface-2 text-text-secondary border border-transparent hover:text-text-primary"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
