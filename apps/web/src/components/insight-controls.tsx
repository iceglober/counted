"use client";
import { useId, useState } from "react";
import { Button } from "@counted/ui/components/button";
import { IconDots } from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@counted/ui/components/dialog";
import { InsightDraft } from "./insight-builder";
import { CreationForm } from "./creation-dialog";
import { Textarea } from "@counted/ui/components/textarea";
import { Input } from "@counted/ui/components/input";
import { Field, Fields, FormActions } from "./form";
import { SelectControl } from "./select-control";
import { SubmitButton } from "./submit";
import {
  duplicateInsight,
  removeInsight,
  updateInsight,
} from "../actions/insights";
import { viewsFor } from "../lib/analysis";
import type { ContractOutputs } from "../lib/client";
type Insight = ContractOutputs["dashboards"]["get"]["dashboard"]["tiles"][number];
export function InsightControls({
  tile,
  dashboardId,
  returnTo,
  projects,
}: {
  tile: Insight;
  dashboardId: string;
  returnTo: string;
  projects: ContractOutputs["projects"]["list"]["items"];
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const window = tile.analysis.shape === "funnel" ? tile.analysis.funnel.window : tile.analysis.window;
  const complex = window.kind === "absolute" || (tile.analysis.shape !== "funnel" && tile.analysis.measure.kind === "unique" && tile.analysis.measure.basis === "person") || (tile.analysis.shape === "funnel" && (tile.analysis.funnel.basis !== "visit" || tile.analysis.funnel.steps.length !== 3 || tile.analysis.funnel.steps.some((step) => step.events.length !== 1 || step.where) || tile.analysis.funnel.conversionWindowMs % 60_000 !== 0));
  const views = viewsFor(tile.analysis.shape);
  const hidden = (
    <>
      <input type="hidden" name="dashboardId" value={dashboardId} />
      <input type="hidden" name="tileId" value={tile.id} />
      <input type="hidden" name="returnTo" value={returnTo} />
    </>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon-sm" />}
        aria-label={`Edit insight: ${tile.title}`}
      >
        <IconDots aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="app-content @container/form max-w-xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{tile.title}</DialogTitle>
          <DialogDescription>
            Adjust the question, period, filters, and display.
          </DialogDescription>
        </DialogHeader>
        {open && !complex ? <InsightDraft dashboardId={dashboardId} returnTo={returnTo} projects={projects} initial={tile} onSaved={() => setOpen(false)} /> : <CreationForm action={async (form) => { const result = await updateInsight(form); if (!result) setOpen(false); return result; }} submitLabel="Save insight" pendingLabel="Saving…">
          {hidden}
          <Fields>
            <Field label="Title" htmlFor={`${id}-title`}>
              <Input
                id={`${id}-title`}
                name="title"
                maxLength={200}
                defaultValue={tile.title}
              />
            </Field>
            <Field label="Display as" htmlFor={`${id}-view`}>
              <SelectControl
                id={`${id}-view`}
                name="view"
                defaultValue={views.includes(tile.view) ? tile.view : views[0]!}
                disabled={views.length === 1}
                items={views.map((value) => ({
                  value,
                  label: value[0]!.toUpperCase() + value.slice(1),
                }))}
              />
            </Field>
          </Fields>
          <Field label="Analysis definition" htmlFor={`${id}-analysis`} hint="This insight uses an advanced definition. Edit its full API-compatible question here."><Textarea id={`${id}-analysis`} name="analysis" rows={8} defaultValue={JSON.stringify(tile.analysis, null, 2)} className="font-mono text-xs" /></Field>
        </CreationForm>}
        <div className="flex flex-wrap gap-3 border-t pt-5">
          <form action={duplicateInsight}>
            {hidden}
            <SubmitButton variant="outline" size="sm" pendingLabel="Copying…">
              Duplicate
            </SubmitButton>
          </form>
          <form action={removeInsight}>
            {hidden}
            <SubmitButton
              variant="destructive"
              size="sm"
              pendingLabel="Removing…"
              confirm={`Remove “${tile.title}” from this dashboard?`}
            >
              Remove insight
            </SubmitButton>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
