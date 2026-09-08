"use client";
import { useId } from "react";
import { Checkbox } from "@counted/ui/components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@counted/ui/components/field";
export default function CheckboxExample({
  variant = "unchecked",
}: {
  variant?: string;
}) {
  const id = useId();
  return (
    <Field
      className="w-full max-w-sm"
      orientation="horizontal"
      data-disabled={variant === "disabled" || undefined}
      data-invalid={variant === "invalid" || undefined}
    >
      <Checkbox
        id={id}
        defaultChecked={variant === "checked"}
        indeterminate={variant === "indeterminate"}
        disabled={variant === "disabled"}
        aria-invalid={variant === "invalid" || undefined}
        aria-describedby={
          variant === "invalid" || variant === "with-description"
            ? id + "-hint"
            : undefined
        }
      />
      <FieldContent>
        <FieldLabel htmlFor={id}>
          {variant === "indeterminate"
            ? "Some records selected"
            : "Include active records"}
        </FieldLabel>
        {variant === "with-description" && (
          <FieldDescription id={id + "-hint"}>
            Show active records in the default collection view.
          </FieldDescription>
        )}
        {variant === "invalid" && (
          <FieldError id={id + "-hint"}>
            Select at least one record state.
          </FieldError>
        )}
      </FieldContent>
    </Field>
  );
}
