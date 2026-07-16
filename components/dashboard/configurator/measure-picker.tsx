"use client";

import { Dropdown } from "@/components/dropdown";

// "Unique users" is intentionally omitted: it aliased ephemeral 30-min session
// IDs and wildly overstated "users". Use "Unique sessions" for session counts.
const AGGREGATIONS = [
  { value: "count", label: "Count" },
  { value: "unique_sessions", label: "Unique sessions" },
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Minimum" },
  { value: "max", label: "Maximum" },
];

const CUSTOM_AGGS = new Set(["sum", "avg", "min", "max"]);

type Props = {
  measureType: string;
  measureProperty: string;
  propKeys: string[];
  onMeasureTypeChange: (value: string) => void;
  onMeasurePropertyChange: (value: string) => void;
};

export function MeasurePicker({ measureType, measureProperty, propKeys, onMeasureTypeChange, onMeasurePropertyChange }: Props) {
  const isCustom = CUSTOM_AGGS.has(measureType);

  return (
    <div className="flex gap-2">
      <Dropdown
        value={measureType}
        options={AGGREGATIONS}
        onChange={onMeasureTypeChange}
        className="flex-1"
      />
      {isCustom && (
        <>
          <span className="text-xs text-text-tertiary self-center">of</span>
          <Dropdown
            value={measureProperty}
            options={propKeys.map((k) => ({ value: k, label: k }))}
            onChange={onMeasurePropertyChange}
            placeholder="Select property..."
            className="flex-1"
          />
        </>
      )}
    </div>
  );
}
