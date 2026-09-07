"use client";

import { useId, useState } from "react";
import { Input } from "@counted/ui/components/input";
import { Textarea } from "@counted/ui/components/textarea";
import { CreationDialog, CreationForm } from "./creation-dialog";
import { CatalogStatus, EventPicker, useProjectCatalog } from "./event-picker";
import { Field } from "./form";
import { SelectControl } from "./select-control";
import { createMonitor } from "../actions/monitors";
import { MEASURES, WINDOW_UNITS } from "../lib/analysis";
import { COMPARISONS, COOLDOWN_UNITS, SUMMARIES } from "../lib/monitors";
import type { ContractOutputs } from "../lib/client";

type Props = {
  workspaceId: string;
  returnTo: string;
  projects: ContractOutputs["projects"]["list"]["items"];
};
export function NewMonitor(props: Props) {
  return (
    <CreationDialog title="New monitor" wide>
      <MonitorDraft {...props} />
    </CreationDialog>
  );
}
function MonitorDraft({ workspaceId, returnTo, projects }: Props) {
  const id = useId();
  const [project, setProject] = useState(projects[0]?.id ?? "");
  const [events, setEvents] = useState<string[]>([]);
  const source = useProjectCatalog(project);
  return (
    <CreationForm
      action={createMonitor}
      submitLabel="Create monitor"
      steps={[
        {
          label: "Watch",
          ready: !!source.catalog,
          content: (
            <div className="space-y-5">
              <Field label="Project" htmlFor={`${id}-project`}>
                <SelectControl
                  id={`${id}-project`}
                  name="projectId"
                  value={project}
                  onValueChange={(value) => {
                    setProject(value ?? "");
                    setEvents([]);
                  }}
                  items={projects.map((one) => ({
                    value: one.id,
                    label: one.name,
                  }))}
                  required
                />
              </Field>
              <CatalogStatus state={source} />
              {source.catalog && (
                <Field
                  label="Events"
                  htmlFor={`${id}-event`}
                  hint="Leave blank to watch all events."
                >
                  <EventPicker id={`${id}-event`} items={[...source.catalog.events]} values={events} onChange={setEvents} />
                </Field>
              )}
              <Field label="Measure" htmlFor={`${id}-measure`}>
                <SelectControl
                  id={`${id}-measure`}
                  name="measure"
                  defaultValue="events"
                  items={[
                    ...MEASURES.filter((one) => one.value !== "people"),
                    ...(source.catalog?.measures ?? []).map((name) => ({ value: `sum:${name}`, label: `Sum of ${name}` })),
                  ]}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Over the last" htmlFor={`${id}-amount`}>
                  <Input
                    id={`${id}-amount`}
                    name="windowAmount"
                    type="number"
                    min={1}
                    required
                    defaultValue={1}
                  />
                </Field>
                <Field label="Unit" htmlFor={`${id}-unit`}>
                  <SelectControl
                    id={`${id}-unit`}
                    name="windowUnit"
                    defaultValue="hour"
                    items={WINDOW_UNITS.map((value) => ({
                      value,
                      label: `${value}s`,
                    }))}
                  />
                </Field>
              </div>
            </div>
          ),
        },
        {
          label: "Threshold",
          content: (
            <div className="space-y-5">
              <Field label="Compare the" htmlFor={`${id}-summary`}>
                <SelectControl
                  id={`${id}-summary`}
                  name="summary"
                  defaultValue="total"
                  items={SUMMARIES}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Alert when" htmlFor={`${id}-comparison`}>
                  <SelectControl
                    id={`${id}-comparison`}
                    name="comparison"
                    defaultValue="above"
                    items={COMPARISONS.map((value) => ({
                      value,
                      label: value[0]!.toUpperCase() + value.slice(1),
                    }))}
                  />
                </Field>
                <Field label="Value" htmlFor={`${id}-value`}>
                  <Input
                    id={`${id}-value`}
                    name="value"
                    type="number"
                    step="any"
                    required
                    placeholder="100"
                  />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">
                Above and below exclude the threshold itself.
              </p>
            </div>
          ),
        },
        {
          label: "Delivery",
          content: (
            <div className="space-y-5">
              <Field label="Name" htmlFor={`${id}-name`}>
                <Input
                  id={`${id}-name`}
                  name="name"
                  required
                  maxLength={200}
                  placeholder="Event volume"
                />
              </Field>
              <Field
                label="Notify"
                htmlFor={`${id}-channels`}
                hint="Email addresses or webhook URLs, one per line. Optional."
              >
                <Textarea
                  id={`${id}-channels`}
                  name="channels"
                  rows={3}
                  placeholder="ops@example.com"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cooldown" htmlFor={`${id}-cooldown`}>
                  <Input
                    id={`${id}-cooldown`}
                    name="cooldownAmount"
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={1}
                  />
                </Field>
                <Field label="Unit" htmlFor={`${id}-cooldown-unit`}>
                  <SelectControl
                    id={`${id}-cooldown-unit`}
                    name="cooldownUnit"
                    defaultValue="hour"
                    items={COOLDOWN_UNITS}
                  />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">
                Time between reminders while the threshold stays crossed.
              </p>
            </div>
          ),
        },
      ]}
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {(events.length ? events : [""]).map((event) => <input key={event} type="hidden" name="events" value={event} />)}
    </CreationForm>
  );
}
