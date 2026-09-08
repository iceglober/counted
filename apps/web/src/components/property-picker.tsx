"use client";

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
import type { ProjectCatalog } from "./event-picker";

export function PropertyPicker({
  id,
  items,
  values,
  onChange,
  "aria-describedby": describedBy,
}: {
  id: string;
  items: ProjectCatalog["dimensions"];
  values: string[];
  onChange: (values: string[]) => void;
  "aria-describedby"?: string;
}) {
  const anchor = useComboboxAnchor();
  const labels = new Map(
    items.map((item) => [
      item.name,
      item.name === "event_type" ? "Event type" : item.label,
    ]),
  );
  return (
    <Combobox
      items={items.map((item) => item.name)}
      multiple
      value={values}
      itemToStringLabel={(value: string) => labels.get(value) ?? value}
      onValueChange={(next: string[]) => {
        if (next.length <= 3) onChange(next);
      }}
    >
      <ComboboxChips ref={anchor} className="w-full">
        <ComboboxValue>
          {values.map((value) => (
            <ComboboxChip
              key={value}
              removeLabel={`Remove ${labels.get(value)}`}
            >
              {labels.get(value)}
            </ComboboxChip>
          ))}
        </ComboboxValue>
        <ComboboxChipsInput
          id={id}
          aria-describedby={describedBy}
          placeholder={values.length ? "Add property…" : "Choose properties…"}
          className="w-0 min-w-24"
        />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>No matching properties.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem
              key={item}
              value={item}
              disabled={values.length >= 3 && !values.includes(item)}
            >
              {labels.get(item)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
