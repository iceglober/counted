"use client";

import { useId, useState } from "react";
import { IconChartAreaLine, IconChartBar, IconHash, IconFilter } from "@tabler/icons-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@counted/ui/components/collapsible";
import { Button } from "@counted/ui/components/button";
import { Input } from "@counted/ui/components/input";
import { RadioGroup, RadioGroupItem } from "@counted/ui/components/radio-group";
import { Label } from "@counted/ui/components/label";
import {
  CreationDialog,
  CreationForm,
  type CreationStep,
} from "./creation-dialog";
import { CatalogStatus, EventPicker, useProjectCatalog } from "./event-picker";
import { InsightFilters } from "./insight-filters";
import { PropertyPicker } from "./property-picker";
import { Field } from "./form";
import { KeyValues } from "./layout";
import { SelectControl } from "./select-control";
import { addInsight, updateInsight } from "../actions/insights";
import {
  build,
  draftFor,
  GRAINS,
  MEASURES,
  WINDOW_UNITS,
  titleFor,
  viewsFor,
} from "../lib/analysis";
import type { Analysis, Predicate, Draft } from "../lib/analysis";
import type { ContractOutputs } from "../lib/client";

const questions = [
  {
    value: "scalar",
    label: "Total",
    description: "One number for the period",
    view: "number",
    icon: IconHash,
  },
  {
    value: "series",
    label: "Trend",
    description: "Follow a metric over time, with an optional split",
    view: "line",
    icon: IconChartAreaLine,
  },
  {
    value: "breakdown",
    label: "Breakdown",
    description: "Compare values or combinations of properties",
    view: "bar",
    icon: IconChartBar,
  },
  { value: "funnel", label: "Funnel", description: "Follow three ordered steps within a visit", view: "funnel", icon: IconFilter },
] as const;
type Question = (typeof questions)[number]["value"];
const displayLabels = {
  number: "Number",
  line: "Line chart",
  bar: "Bar chart",
  table: "Table",
  funnel: "Funnel",
  retention: "Retention",
};
type Props = {
  dashboardId: string;
  returnTo: string;
  projects: ContractOutputs["projects"]["list"]["items"];
  label?: string;
  onSaved?: () => void;
  initial?: ContractOutputs["dashboards"]["get"]["dashboard"]["tiles"][number];
};

export function InsightBuilder({ label = "New insight", ...props }: Props) {
  return (
    <CreationDialog title="New insight" trigger={label} wide>
      <InsightDraft {...props} />
    </CreationDialog>
  );
}

export function InsightDraft({ dashboardId, returnTo, projects, initial, onSaved }: Props) {
  const seeded = initial ? draftFor(initial.analysis, initial.view) : null;
  const id = useId();
  const [question, setQuestion] = useState<Question>(initial?.analysis.shape ?? "scalar");
  const [view, setView] = useState(seeded?.view ?? "number");
  const [project, setProject] = useState(initial?.project ?? projects[0]?.id ?? "");
  const [events, setEvents] = useState<string[]>([...(seeded?.events ?? [])]);
  const [measure, setMeasure] = useState(seeded?.measure ?? "events");
  const [amount, setAmount] = useState(String(seeded?.windowAmount ?? 7));
  const [unit, setUnit] = useState(seeded?.windowUnit ?? "day");
  const [properties, setProperties] = useState<string[]>([...(seeded?.dimensions ?? [])]);
  const [splitBy, setSplitBy] = useState(seeded?.splitBy ?? "");
  const [grain, setGrain] = useState(seeded?.grain ?? "");
  const [seriesLimit, setSeriesLimit] = useState(String(seeded?.seriesLimit ?? 3));
  const [limit, setLimit] = useState(String(seeded?.limit ?? 10));
  const [where, setWhere] = useState<Predicate | undefined>(seeded?.where);
  const [funnelSteps, setFunnelSteps] = useState([0, 1, 2].map((index) => seeded?.funnelSteps?.[index]?.events[0] ?? ""));
  const [conversionMinutes, setConversionMinutes] = useState(String(seeded?.conversionMinutes ?? 30));
  const [customProperties, setCustomProperties] = useState<string[]>([...(seeded?.dimensions ?? []), seeded?.splitBy ?? ""].filter((name) => name.startsWith("property:")).map((name) => name.slice(9)));
  const [customProperty, setCustomProperty] = useState("");
  const source = useProjectCatalog(project);
  const known = source.catalog?.dimensions.filter((one) => one.status === "indexed" || one.status === "scanned").map((one) => ({ ...one, name: one.source === "property" ? `property:${one.name}` : one.name })) ?? [];
  const dimensions = [...known, ...customProperties.filter((name) => !known.some((one) => one.name === `property:${name}`)).map((name) => ({name: `property:${name}`, label: name, status: "scanned" as const, source: "property" as const}))];
  const propertyLabel = (key: string) =>
    key === "event_type"
      ? "Event type"
      : (dimensions.find((one) => one.name === key)?.label ?? key);
  const funnel = question === "funnel";
  const breakdown = question === "breakdown";
  const trend = question === "series";
  const groupedByEvent = breakdown
    ? properties.includes("event_type")
    : trend && splitBy === "event_type";
  const draft: Draft = {
    view,
    where,
    funnelSteps: funnelSteps.map((event, index) => ({ ...seeded?.funnelSteps?.[index], events: [event] })),
    conversionMinutes: Number(conversionMinutes),
    events,
    measure,
    windowAmount: Number(amount),
    windowUnit: unit,
    grain,
    dimension: undefined,
    dimensions: breakdown ? properties : [],
    splitBy: trend ? splitBy || undefined : undefined,
    seriesLimit: Number(seriesLimit),
    limit: Number(limit),
  };
  const displays = viewsFor(question);
  const validGroups = breakdown
    ? properties.length > 0 &&
      properties.every((key) => dimensions.some((one) => one.name === key))
    : !trend || !splitBy || dimensions.some((one) => one.name === splitBy);
  const ready = !!source.catalog && validGroups && build(draft).ok;
  const steps: CreationStep[] = [
    {
      label: "Type",
      content: (
        <RadioGroup
          aria-label="What would you like to see?"
          value={question}
          onValueChange={(value) => {
            const choice = questions.find((one) => one.value === value);
            if (choice) {
              setQuestion(choice.value);
              setView(
                choice.value === "breakdown" && properties.length > 1
                  ? "table"
                  : choice.view,
              );
            }
          }}
          className="gap-3"
        >
          {questions.map((one) => (
            <Label
              key={one.value}
              className={`flex min-w-0 cursor-pointer items-center gap-3 border p-4 ${question === one.value ? "border-primary bg-accent/50" : "hover:bg-muted/50"}`}
            >
              <one.icon
                aria-hidden="true"
                className="size-5 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block font-medium">{one.label}</span>
                <span className="block text-xs leading-relaxed text-muted-foreground">
                  {one.description}
                </span>
              </span>
              <RadioGroupItem value={one.value} />
            </Label>
          ))}
        </RadioGroup>
      ),
    },
    {
      label: "Data",
      ready: !!source.catalog,
      content: (
        <div className="space-y-5">
          <Field label="Project" htmlFor={`${id}-project`}>
            <SelectControl
              id={`${id}-project`}
              name="project"
              value={project}
              onValueChange={(value) => {
                setProject(value ?? "");
                setEvents([]);
                setProperties([]);
                setSplitBy("");
                setMeasure("events");
                setWhere(undefined);
                setCustomProperties([]);
                setFunnelSteps(["", "", ""]);
              }}
              items={projects.map((one) => ({
                value: one.id,
                label: one.name,
              }))}
              required
              disabled={!!initial}
            />
          </Field>
          <CatalogStatus state={source} />
          {!funnel && source.catalog && <Collapsible className="text-xs text-muted-foreground"><CollapsibleTrigger render={<Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" />}>Property not listed?</CollapsibleTrigger><CollapsibleContent className="mt-3 space-y-2"><p>Suggestions come from recent events. Enter an exact property key to use it in filters or breakdowns.</p><div className="flex gap-2"><Input aria-label="Custom property key" value={customProperty} onChange={(event) => setCustomProperty(event.target.value)} placeholder="url" className="min-w-0" /><Button type="button" variant="outline" disabled={!customProperty.trim() || customProperty.trim().startsWith("$")} onClick={() => { setCustomProperties((before) => [...new Set([...before, customProperty.trim()])]); setCustomProperty(""); }}>Add</Button></div></CollapsibleContent></Collapsible>}
          {source.catalog && (
            <>
              {!funnel && <>
              <Field label="Events" htmlFor={`${id}-events`}>
                <EventPicker
                  id={`${id}-events`}
                  items={source.catalog.events}
                  values={events}
                  onChange={setEvents}
                  hint={
                    events.length === 1
                      ? "One event type selected."
                      : groupedByEvent
                        ? "Event types are compared separately."
                        : "Event types are combined into one measure."
                  }
                />
              </Field>
              <Field
                label="Measure"
                htmlFor={`${id}-measure`}
                hint={
                  measure === "visits"
                    ? question === "scalar"
                      ? "Each visit is counted once over the whole period."
                      : trend
                        ? "Each visit is counted once per group and time interval."
                        : "Each visit is counted once per property combination."
                    : undefined
                }
              >
                <SelectControl
                  id={`${id}-measure`}
                  name="measure"
                  value={measure}
                  onValueChange={(value) => setMeasure(value ?? "events")}
                  items={[
                    ...MEASURES.filter((one) => one.value !== "people"),
                    ...source.catalog.measures.map((name) => ({
                      value: `sum:${name}`,
                      label: `Sum of ${name}`,
                    })),
                  ]}
                />
              </Field>
              </>}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Over the last" htmlFor={`${id}-amount`}>
                  <Input
                    id={`${id}-amount`}
                    name="windowAmount"
                    type="number"
                    min={1}
                    step={1}
                    required
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </Field>
                <Field label="Unit" htmlFor={`${id}-unit`}>
                  <SelectControl
                    id={`${id}-unit`}
                    name="windowUnit"
                    value={unit}
                    onValueChange={(value) => setUnit(value ?? "day")}
                    items={WINDOW_UNITS.map((value) => ({
                      value,
                      label: `${value}s`,
                    }))}
                  />
                </Field>
              </div>
            </>
          )}
        </div>
      ),
    },
    ...(question === "scalar"
      ? []
      : [
          {
            label: "Display",
            ready,
            content: (
              <div className="space-y-5">
                {funnel && <>
                  <p className="text-sm text-muted-foreground">Each visit must complete these steps in order. A visit ends after 30 minutes idle.</p>
                  {funnelSteps.map((event, index) => <Field key={index} label={`Step ${index + 1}`} htmlFor={`${id}-step-${index}`}><SelectControl id={`${id}-step-${index}`} value={event} items={[{value: "", label: "Choose an event"}, ...[...new Set([...(source.catalog?.events ?? []), ...funnelSteps.filter(Boolean)])].map((name) => ({value: name, label: name}))]} onValueChange={(value) => setFunnelSteps((before) => before.map((one, i) => i === index ? value ?? "" : one))} /></Field>)}
                  <Field label="Convert within" htmlFor={`${id}-conversion`} hint="Minutes from the first step to the last; up to 7 days."><Input id={`${id}-conversion`} type="number" min={1} max={10080} step={1} value={conversionMinutes} onChange={(event) => setConversionMinutes(event.target.value)} /></Field>
                </>}
                {breakdown && (
                  <>
                    <Field
                      label="Break down by"
                      htmlFor={`${id}-properties`}
                      hint="Up to three properties. Each result is one combination."
                    >
                      <PropertyPicker
                        id={`${id}-properties`}
                        items={dimensions}
                        values={properties}
                        onChange={(values) => {
                          setProperties(values);
                          if (values.length > 1 && properties.length < 2)
                            setView("table");
                        }}
                      />
                    </Field>
                    <Field label="Show" htmlFor={`${id}-limit`}>
                      <SelectControl
                        id={`${id}-limit`}
                        name="limit"
                        value={limit}
                        onValueChange={(value) => setLimit(value ?? "10")}
                        items={[...new Set([5, 10, 20, seeded?.limit ?? 10])].sort((a,b) => a-b).map((n) => ({
                          value: String(n),
                          label: `Top ${n} combinations`,
                        }))}
                      />
                    </Field>
                  </>
                )}
                {trend && (
                  <>
                    <Field
                      label="Split by"
                      htmlFor={`${id}-split`}
                      hint={
                        splitBy
                          ? `Top ${seriesLimit} groups over the period, kept consistent across time.`
                          : "Choose Event type to compare the selected events."
                      }
                    >
                      <SelectControl
                        id={`${id}-split`}
                        name="splitBy"
                        value={splitBy}
                        onValueChange={(value) => setSplitBy(value ?? "")}
                        items={[
                          { value: "", label: "No split · one series" },
                          ...dimensions.map((one) => ({
                            value: one.name,
                            label: propertyLabel(one.name),
                          })),
                        ]}
                      />
                    </Field>
                    {splitBy && <Field label="Series" htmlFor={`${id}-series-limit`}><SelectControl id={`${id}-series-limit`} value={seriesLimit} onValueChange={(value) => setSeriesLimit(value ?? "3")} items={[1,2,3].map((n) => ({value: String(n), label: `Top ${n} group${n === 1 ? "" : "s"}`}))} /></Field>}
                    <Field label="Time interval" htmlFor={`${id}-grain`}>
                      <SelectControl
                        id={`${id}-grain`}
                        name="grain"
                        value={grain}
                        onValueChange={(value) => setGrain(value ?? "")}
                        items={[
                          { value: "", label: "Automatic" },
                          ...GRAINS.map((value) => ({
                            value,
                            label: `Per ${value}`,
                          })),
                        ]}
                      />
                    </Field>
                  </>
                )}
                {!funnel && <Field label="Display as" htmlFor={`${id}-display`}>
                  <SelectControl
                    id={`${id}-display`}
                    value={view}
                    onValueChange={(value) => setView(value ?? displays[0]!)}
                    items={displays.map((value) => ({
                      value,
                      label: displayLabels[value],
                    }))}
                  />
                </Field>
                }
                {breakdown && events.length !== 1 && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {groupedByEvent
                      ? "Event types are compared separately."
                      : "Selected events are combined. Add Event type to compare them."}
                  </p>
                )}
              </div>
            ),
          },
        ]),
    ...(!funnel ? [{ label: "Filters", ready: !!source.catalog, content: <InsightFilters id={`${id}-filters`} items={dimensions.map((one) => ({ value: one.name, label: one.label }))} value={where} onChange={setWhere} /> }] : []),
    {
      label: "Review",
      ready,
      content: (
        <div className="space-y-5">
          <Field
            label="Title"
            htmlFor={`${id}-title`}
            hint="Leave blank to use the suggested title."
          >
            <Input
              id={`${id}-title`}
              name="title"
              maxLength={200}
              placeholder={titleFor(draft)}
              defaultValue={initial?.title}
            />
          </Field>
          <div className="border bg-muted/20 p-4 [&_dl]:gap-y-2">
            <KeyValues
              rows={[
                {
                  label: "Display",
                  value: displayLabels[view as keyof typeof displayLabels],
                },
                {
                  label: "Project",
                  value: projects.find((one) => one.id === project)?.name,
                },
                {
                  label: "Events",
                  value: funnel ? funnelSteps.join(" → ") : events.length ? events.join(", ") : "All events",
                },
                ...(!funnel && events.length > 1
                  ? [
                      {
                        label: "Event mode",
                        value: groupedByEvent
                          ? "Compared separately"
                          : "Combined",
                      },
                    ]
                  : []),
                {
                  label: "Measure",
                  value:
                    funnel ? `Unique visits · within ${conversionMinutes} minutes` : MEASURES.find((one) => one.value === measure)?.label ??
                    `Sum of ${measure.slice(4)}`,
                },
                ...(breakdown
                  ? [
                      {
                        label: "Properties",
                        value: properties.map(propertyLabel).join(" × "),
                      },
                      { label: "Show", value: `Top ${limit} combinations` },
                    ]
                  : []),
                ...(trend
                  ? [
                      {
                        label: "Split",
                        value: splitBy
                          ? `${propertyLabel(splitBy)} · Top ${seriesLimit}`
                          : "None",
                      },
                      {
                        label: "Interval",
                        value: grain ? `Per ${grain}` : "Automatic",
                      },
                    ]
                  : []),
                {
                  label: "Period",
                  value: `Last ${amount} ${unit}${amount === "1" ? "" : "s"}`,
                },
              ]}
            />
          </div>
        </div>
      ),
    },
  ];
  return (
    <CreationForm
      action={async (form) => { const result = await (initial ? updateInsight(form) : addInsight(form)); if (!result) onSaved?.(); return result; }}
      submitLabel={initial ? "Save insight" : "Add insight"}
      pendingLabel={initial ? "Saving…" : "Adding…"}
      steps={steps}
    >
      {initial && <><input type="hidden" name="tileId" value={initial.id} /><input type="hidden" name="analysis" value={JSON.stringify(editAnalysis(initial.analysis, draft))} /><input type="hidden" name="project" value={project} /></>}
      <input type="hidden" name="seriesLimit" value={seriesLimit} />
      <input type="hidden" name="where" value={where ? JSON.stringify(where) : ""} />
      <input type="hidden" name="funnelSteps" value={JSON.stringify(draft.funnelSteps)} />
      <input type="hidden" name="conversionMinutes" value={conversionMinutes} />
      {funnel && <input type="hidden" name="measure" value="events" />}
      <input type="hidden" name="view" value={view} />
      <input type="hidden" name="dashboardId" value={dashboardId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {events.map((event) => (
        <input key={event} type="hidden" name="events" value={event} />
      ))}
      {breakdown &&
        properties.map((property) => (
          <input
            key={property}
            type="hidden"
            name="dimensions"
            value={property}
          />
        ))}
    </CreationForm>
  );
}

function editAnalysis(original: Analysis, draft: Draft): Analysis {
  const next = build(draft);
  if (!next.ok) return original;
  if (original.shape === "scalar" && next.analysis.shape === "scalar") return { ...next.analysis, summary: original.summary };
  if (original.shape === "breakdown" && next.analysis.shape === "breakdown") return { ...next.analysis, order: original.order };
  return next.analysis;
}
