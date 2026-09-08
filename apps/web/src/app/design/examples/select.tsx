"use client";
import { useId, useState } from "react";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@counted/ui/components/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@counted/ui/components/select";
const items = [
  { value: "production", label: "Production" },
  { value: "staging", label: "Staging" },
  { value: "development", label: "Development" },
];
export default function SelectExample({
  variant = "single",
}: {
  variant?: string;
}) {
  const id = useId();
  const multiple = variant === "multiple";
  const [value, setValue] = useState<string | string[] | null>(
    multiple
      ? ["production", "staging"]
      : variant === "placeholder" || variant === "invalid"
        ? null
        : "production",
  );
  return (
    <Field
      className="w-full max-w-sm"
      data-disabled={variant === "disabled" || undefined}
      data-invalid={variant === "invalid" || undefined}
    >
      <FieldLabel htmlFor={id}>
        {multiple ? "Environments" : "Environment"}
      </FieldLabel>
      <Select
        items={items}
        multiple={multiple}
        value={value}
        onValueChange={setValue}
        disabled={variant === "disabled"}
      >
        <SelectTrigger
          id={id}
          className="w-full"
          size={variant === "small" ? "sm" : "default"}
          aria-invalid={variant === "invalid" || undefined}
          aria-describedby={id + "-hint"}
        >
          <SelectValue
            placeholder={
              multiple ? "Choose environments" : "Choose an environment"
            }
          >
            {multiple
              ? Array.isArray(value) && value.length
                ? value
                    .map((v) => items.find((i) => i.value === v)?.label)
                    .join(", ")
                : "Choose environments"
              : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {variant === "invalid" ? (
        <FieldError id={id + "-hint"}>
          Choose an environment to continue.
        </FieldError>
      ) : (
        <FieldDescription id={id + "-hint"}>
          {multiple
            ? "Select several options. Select an option again to remove it; Escape closes the list."
            : "Use the arrow keys to browse options."}
        </FieldDescription>
      )}
      {multiple && (
        <p className="text-xs text-muted-foreground" role="status">
          {Array.isArray(value) ? value.length : 0} selected
        </p>
      )}
    </Field>
  );
}
