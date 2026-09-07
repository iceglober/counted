"use client";

import { useEffect, useState } from "react";
import { Button } from "@counted/ui/components/button";
import { Alert, AlertDescription } from "@counted/ui/components/alert";
import { Skeleton } from "@counted/ui/components/skeleton";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@counted/ui/components/combobox";
import { projectCatalog } from "../actions/catalog";
import { failureOf, sentenceFor } from "../lib/failure";
import type { Attempt, ContractOutputs } from "../lib/client";

export type ProjectCatalog = ContractOutputs["queries"]["schema"]["schema"];

export function useProjectCatalog(projectId: string) {
  const [result, setResult] = useState<{
    projectId: string;
    result: Attempt<ContractOutputs["queries"]["schema"]>;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setResult(null);
    projectCatalog(projectId).then(
      (result) => {
        if (current) setResult({ projectId, result });
      },
      (error) => {
        if (current)
          setResult({
            projectId,
            result: { ok: false, failure: failureOf(error) },
          });
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, revision]);
  const outcome = result?.projectId === projectId ? result.result : null;
  return {
    catalog: outcome?.ok ? outcome.value.schema : null,
    failure: outcome && !outcome.ok ? outcome.failure : null,
    loading: !outcome,
    retry: () => setRevision((value) => value + 1),
  };
}

export function CatalogStatus({
  state,
}: {
  state: ReturnType<typeof useProjectCatalog>;
}) {
  if (state.loading)
    return (
      <div
        role="status"
        aria-label="Loading project events"
        className="space-y-2"
      >
        <Skeleton className="h-10 w-full" />
        <span className="sr-only">Loading project events…</span>
      </div>
    );
  if (state.failure)
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {sentenceFor(state.failure)}{" "}
          <Button type="button" variant="link" size="sm" onClick={state.retry}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  return null;
}

export function EventPicker({
  id,
  items,
  values,
  onChange,
  hint,
}: {
  id: string;
  items: string[];
  values: string[];
  onChange: (values: string[]) => void;
  hint?: string;
}) {
  const anchor = useComboboxAnchor();
  return (
    <div className="min-w-0 space-y-2">
      <Combobox
        items={[...new Set(items)].sort()}
        multiple
        value={values}
        onValueChange={onChange}
      >
        <ComboboxChips ref={anchor} className="w-full">
          <ComboboxValue>
            {values.map((item) => (
              <ComboboxChip key={item} removeLabel={`Remove ${item}`}>
                {item}
              </ComboboxChip>
            ))}
          </ComboboxValue>
          <ComboboxChipsInput
            id={id}
            aria-describedby={`${id}-hint`}
            placeholder={
              values.length ? "Add events…" : "All events · search to filter"
            }
            className="w-0 min-w-24"
          />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>
            {items.length ? "No matching events." : "No events recorded yet."}
          </ComboboxEmpty>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                <span className="min-w-0 [overflow-wrap:anywhere]">{item}</span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <div
        id={`${id}-hint`}
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground"
      >
        <span>
          {hint ??
            (values.length
              ? `${values.length} selected · combined`
              : items.length
                ? "Includes every event unless you choose a filter."
                : "All events includes new events as they arrive.")}
        </span>
        {values.length > 0 && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => onChange([])}
          >
            Use all events
          </Button>
        )}
      </div>
    </div>
  );
}
