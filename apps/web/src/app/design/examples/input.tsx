"use client";
import { useId } from "react";
import { Input } from "@counted/ui/components/input";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@counted/ui/components/field";
export default function InputExample({
  variant = "default",
}: {
  variant?: string;
}) {
  const id = useId();
  return (
    <Field
      className="w-full max-w-sm"
      data-disabled={variant === "disabled" || undefined}
      data-invalid={variant === "invalid" || undefined}
    >
      <FieldLabel htmlFor={id}>
        {variant === "password"
          ? "Example key"
          : variant === "number"
            ? "Row limit"
            : "Record name"}
      </FieldLabel>
      <Input
        id={id}
        type={
          variant === "password"
            ? "password"
            : variant === "number"
              ? "number"
              : "text"
        }
        min={variant === "number" ? 1 : undefined}
        disabled={variant === "disabled"}
        readOnly={variant === "read-only"}
        aria-invalid={variant === "invalid" || undefined}
        aria-describedby={id + "-hint"}
        placeholder="e.g. acme-web"
        defaultValue={
          variant === "number"
            ? "25"
            : variant === "invalid"
              ? "Acme Web!"
              : variant === "default"
                ? ""
                : "acme-web"
        }
      />
      {variant === "invalid" ? (
        <FieldError id={id + "-hint"}>
          Use lowercase letters, numbers, and hyphens.
        </FieldError>
      ) : (
        <FieldDescription id={id + "-hint"}>
          {variant === "read-only"
            ? "This value can be selected and copied."
            : "Use a value you can recognize later."}
        </FieldDescription>
      )}
    </Field>
  );
}
