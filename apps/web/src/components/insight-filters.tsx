"use client";

import { Button } from "@counted/ui/components/button";
import { Input } from "@counted/ui/components/input";
import { Textarea } from "@counted/ui/components/textarea";
import { IconPlus, IconX } from "@tabler/icons-react";
import { Field } from "./form";
import { SelectControl } from "./select-control";
import { fieldFor, valueForField, type Predicate } from "../lib/analysis";

type Item = { value: string; label: string };
const operators = [
  { value: "eq", label: "is" }, { value: "neq", label: "is not" },
  { value: "contains", label: "contains" }, { value: "startsWith", label: "starts with" },
  { value: "endsWith", label: "ends with" }, { value: "exists", label: "has a value" },
  { value: "notExists", label: "has no value" },
  { value: "gt", label: "is greater than" }, { value: "gte", label: "is at least" },
  { value: "lt", label: "is less than" }, { value: "lte", label: "is at most" },
] as const;
type Leaf = Extract<Predicate, { field: unknown }>;
const simple = (one: Predicate): one is Leaf => "field" in one && operators.some((op) => op.value === one.op) && (!("value" in one) || typeof one.value === "string" || ["gt", "gte", "lt", "lte"].includes(one.op));

/** Existing complex predicates remain intact and can be edited as the public IR. */
export function InsightFilters({ id, items, value, onChange }: {
  id: string; items: Item[]; value?: Predicate | undefined; onChange: (value: Predicate | undefined) => void;
}) {
  const parts = value ? value.op === "and" ? value.operands : [value] : [];
  const emit = (next: Predicate[]) => onChange(next.length === 0 ? undefined : next.length === 1 ? next[0] : { op: "and", operands: next });
  if (!parts.every(simple)) return <Field label="Property filters" htmlFor={id} hint="This insight uses an advanced filter. Its complete definition is preserved."><Textarea id={id} defaultValue={JSON.stringify(value, null, 2)} rows={6} onChange={(event) => { try { onChange(JSON.parse(event.target.value)); event.target.setCustomValidity(""); } catch { event.target.setCustomValidity("Enter valid JSON."); } }} /></Field>;
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Property filters</span><Button type="button" size="sm" variant="ghost" disabled={!items.length || parts.length >= 5} onClick={() => emit([...parts, { op: "eq", field: fieldFor(items[0]!.value), value: "" }])}><IconPlus aria-hidden="true" />Add filter</Button></div>
    {parts.length === 0 ? <p className="text-xs text-muted-foreground">Include every property value.</p> : parts.map((part, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border p-3">
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        <SelectControl aria-label={`Filter ${index + 1} property`} value={valueForField(part.field)} items={items} onValueChange={(key) => emit(parts.map((one, i) => i === index ? { ...one, field: fieldFor(key ?? items[0]!.value) } : one))} />
        <SelectControl aria-label={`Filter ${index + 1} condition`} value={part.op} items={[...operators]} onValueChange={(op) => emit(parts.map((one, i) => i === index ? { op, field: one.field, ...(op === "exists" || op === "notExists" ? {} : { value: ["gt", "gte", "lt", "lte"].includes(op ?? "") ? Number("value" in one ? one.value : 0) || 0 : "value" in one ? String(one.value) : "" }) } as Predicate : one))} />
        {part.op !== "exists" && part.op !== "notExists" && <Input type={["gt", "gte", "lt", "lte"].includes(part.op) ? "number" : "text"} step="any" required className="sm:col-span-2" aria-label={`Filter ${index + 1} value`} placeholder="Property value" value={"value" in part ? String(part.value) : ""} onChange={(event) => emit(parts.map((one, i) => i === index ? { ...one, value: ["gt", "gte", "lt", "lte"].includes(one.op) ? Number(event.target.value) : event.target.value } as Predicate : one))} />}
      </div>
      <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove filter ${index + 1}`} onClick={() => emit(parts.filter((_, i) => i !== index))}><IconX aria-hidden="true" /></Button>
    </div>)}
    {parts.length > 1 && <p className="text-xs text-muted-foreground">All filters must match.</p>}
  </div>;
}
