"use client";

import { useId, useState } from "react";
import { Input } from "@counted/ui/components/input";
import { setMonitorAnalysis } from "../actions/monitors";
import { draftFor, MEASURES, WINDOW_UNITS } from "../lib/analysis";
import { SUMMARIES, type Monitor } from "../lib/monitors";
import { CatalogStatus, EventPicker, useProjectCatalog } from "./event-picker";
import { Field, FormActions } from "./form";
import { SelectControl } from "./select-control";
import { SubmitButton } from "./submit";

export function MonitorAnalysisEditor({ monitor, returnTo }: { monitor: Monitor; returnTo: string }) {
  const id = useId();
  const initial = draftFor(monitor.analysis, "number");
  const [events, setEvents] = useState<string[]>([...initial.events ?? []]);
  const source = useProjectCatalog(monitor.project);
  if (monitor.analysis.shape !== "scalar") return <p>This monitor must measure a single number. Update its analysis in API Explorer.</p>;
  const measures: { value: string; label: string }[] = [
    ...MEASURES.filter((one) => one.value !== "people"),
    ...(source.catalog?.measures ?? []).map((name) => ({ value: `sum:${name}`, label: `Sum of ${name}` })),
  ];
  if (!measures.some((one) => one.value === initial.measure)) measures.push({ value: initial.measure, label: initial.measure.startsWith("sum:") ? `Sum of ${initial.measure.slice(4)}` : initial.measure });
  return (
    <form action={setMonitorAnalysis} className="space-y-5">
      <input type="hidden" name="monitorId" value={monitor.id} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {(events.length ? events : [""]).map((event) => <input key={event} type="hidden" name="events" value={event} />)}
      <CatalogStatus state={source} />
      <Field label="Events" htmlFor={`${id}-events`}>
        <EventPicker id={`${id}-events`} items={[...source.catalog?.events ?? [], ...events]} values={events} onChange={setEvents} />
      </Field>
      {initial.where && <p className="text-xs text-muted-foreground">Existing property and advanced filters are retained when you save.</p>}
      <Field label="Measure" htmlFor={`${id}-measure`}>
        <SelectControl id={`${id}-measure`} name="measure" defaultValue={initial.measure} items={measures} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Over the last" htmlFor={`${id}-amount`}>
          <Input id={`${id}-amount`} name="windowAmount" type="number" min={1} required defaultValue={initial.windowAmount ?? 1} />
        </Field>
        <Field label="Unit" htmlFor={`${id}-unit`}>
          <SelectControl id={`${id}-unit`} name="windowUnit" defaultValue={initial.windowUnit} items={WINDOW_UNITS.map((value) => ({ value, label: `${value}s` }))} />
        </Field>
      </div>
      {monitor.analysis.window.kind === "absolute" && <p className="text-xs text-muted-foreground">Saving replaces the fixed date range with this rolling window.</p>}
      <Field label="Compare the" htmlFor={`${id}-summary`}>
        <SelectControl id={`${id}-summary`} name="summary" defaultValue={monitor.analysis.summary} items={SUMMARIES} />
      </Field>
      <p className="text-xs text-muted-foreground">Changing the measurement starts a fresh check and resets the breach state.</p>
      <FormActions><SubmitButton pendingLabel="Saving…" variant="outline">Save measurement</SubmitButton></FormActions>
    </form>
  );
}
