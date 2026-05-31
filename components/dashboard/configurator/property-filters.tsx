"use client";

import { Dropdown } from "@/components/dropdown";
import { Plus, X } from "lucide-react";
import type { PropFilter } from "@/lib/types";

const SYSTEM_FIELDS = [
  { value: "os_name", label: "Operating system" },
  { value: "os_version", label: "OS version" },
  { value: "locale", label: "Locale" },
  { value: "app_version", label: "App version" },
  { value: "device_model", label: "Device model" },
];

const OPERATORS = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "gt", label: "greater than" },
  { value: "lt", label: "less than" },
  { value: "in", label: "in" },
];

type SystemFields = {
  osNames: string[];
  locales: string[];
  appVersions: string[];
};

type Props = {
  filters: PropFilter[];
  propKeys: string[];
  systemFields: SystemFields;
  onAdd: () => void;
  onUpdate: (index: number, filter: PropFilter) => void;
  onRemove: (index: number) => void;
};

function getKnownValues(field: string, systemFields: SystemFields): string[] | null {
  switch (field) {
    case "os_name": return systemFields.osNames;
    case "locale": return systemFields.locales;
    case "app_version": return systemFields.appVersions;
    default: return null;
  }
}

export function PropertyFilters({ filters, propKeys, systemFields, onAdd, onUpdate, onRemove }: Props) {
  const fieldOptions = [
    ...SYSTEM_FIELDS,
    ...propKeys.map((k) => ({ value: `prop:${k}`, label: k, detail: "prop" })),
  ];

  return (
    <div className="space-y-2">
      {filters.map((filter, i) => {
        const incomplete = !filter.field || !filter.value;
        const knownValues = getKnownValues(filter.field, systemFields);

        return (
          <div
            key={i}
            className={`flex items-center gap-1.5 ${incomplete ? "opacity-50" : ""}`}
          >
            <Dropdown
              value={filter.field.startsWith("prop:") ? filter.field : filter.field}
              options={fieldOptions}
              onChange={(v) => onUpdate(i, { ...filter, field: v })}
              placeholder="Field..."
              className="flex-1"
            />
            <Dropdown
              value={filter.operator}
              options={OPERATORS}
              onChange={(v) => onUpdate(i, { ...filter, operator: v as PropFilter["operator"] })}
              className="w-28"
            />
            {knownValues ? (
              <Dropdown
                value={filter.value as string}
                options={knownValues.map((v) => ({ value: v, label: v }))}
                onChange={(v) => onUpdate(i, { ...filter, value: v })}
                placeholder="Value..."
                className="flex-1"
              />
            ) : (
              <input
                type="text"
                value={filter.value as string}
                onChange={(e) => onUpdate(i, { ...filter, value: e.target.value })}
                placeholder={filter.operator === "in" ? "val1, val2, ..." : "Value..."}
                className="flex-1 px-2.5 py-1.5 text-xs bg-surface-2 border border-border rounded-md text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent/60"
              />
            )}
            <button
              onClick={() => onRemove(i)}
              className="p-1 text-text-tertiary hover:text-error transition-colors shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
      <button
        onClick={onAdd}
        className="flex items-center gap-1 text-xs text-text-tertiary hover:text-accent transition-colors"
      >
        <Plus className="w-3 h-3" />
        Add filter
      </button>
    </div>
  );
}
