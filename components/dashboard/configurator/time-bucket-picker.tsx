"use client";

const BUCKETS = [
  { value: "hour" as const, label: "Hourly" },
  { value: "day" as const, label: "Daily" },
  { value: "week" as const, label: "Weekly" },
  { value: "month" as const, label: "Monthly" },
];

type Props = {
  value: string;
  onChange: (value: "hour" | "day" | "week" | "month") => void;
};

export function TimeBucketPicker({ value, onChange }: Props) {
  return (
    <div className="flex gap-1.5">
      {BUCKETS.map((b) => (
        <button
          key={b.value}
          onClick={() => onChange(b.value)}
          className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
            value === b.value
              ? "bg-accent/15 text-accent border border-accent/30"
              : "bg-surface-2 text-text-secondary border border-transparent hover:text-text-primary"
          }`}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
