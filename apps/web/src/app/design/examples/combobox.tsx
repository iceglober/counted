"use client";
import { useId, useState } from "react";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@counted/ui/components/combobox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@counted/ui/components/field";
const records = [
  "acme-web",
  "acme-api",
  "acme-docs",
  "atlas-web",
  "atlas-api",
  "studio-web",
];
export default function ComboboxExample({
  variant = "single",
}: {
  variant?: string;
}) {
  const id = useId();
  const anchor = useComboboxAnchor();
  const [values, setValues] = useState<string[]>(["acme-web", "acme-api"]);
  const items = variant === "empty" ? [] : records;
  const options = (
    <ComboboxContent anchor={variant === "multiple" ? anchor : undefined}>
      <ComboboxEmpty>No matching records.</ComboboxEmpty>
      <ComboboxList>
        {(item: string) => (
          <ComboboxItem key={item} value={item}>
            {item}
          </ComboboxItem>
        )}
      </ComboboxList>
    </ComboboxContent>
  );
  return (
    <Field
      className="w-full max-w-sm"
      data-disabled={variant === "disabled" || undefined}
      data-invalid={variant === "invalid" || undefined}
    >
      <FieldLabel htmlFor={id}>
        {variant === "multiple" ? "Find records" : "Find a record"}
      </FieldLabel>
      {variant === "multiple" ? (
        <Combobox
          items={items}
          multiple
          value={values}
          onValueChange={setValues}
        >
          <ComboboxChips ref={anchor}>
            <ComboboxValue>
              {values.map((item) => (
                <ComboboxChip key={item} removeLabel={`Remove ${item}`}>
                  {item}
                </ComboboxChip>
              ))}
            </ComboboxValue>
            <ComboboxChipsInput
              id={id}
              placeholder="Add records…"
              aria-describedby={id + "-hint"}
            />
          </ComboboxChips>
          {options}
        </Combobox>
      ) : (
        <Combobox
          items={items}
          disabled={variant === "disabled"}
          defaultValue={variant === "clearable" ? "acme-web" : null}
        >
          <ComboboxInput
            id={id}
            placeholder="Search records…"
            showClear={variant === "clearable"}
            disabled={variant === "disabled"}
            aria-invalid={variant === "invalid" || undefined}
            aria-describedby={id + "-hint"}
          />
          {options}
        </Combobox>
      )}
      {variant === "invalid" ? (
        <FieldError id={id + "-hint"}>Choose a record to continue.</FieldError>
      ) : (
        <FieldDescription id={id + "-hint"}>
          {variant === "multiple"
            ? "Search and select several records. Remove a chip to deselect it."
            : "Try “acme”, or type a name that does not exist."}
        </FieldDescription>
      )}
      {variant === "multiple" && (
        <p className="text-xs text-muted-foreground" role="status">
          {values.length} selected
        </p>
      )}
    </Field>
  );
}
