"use client";
import { useId, useState } from "react";
import { Textarea } from "@counted/ui/components/textarea";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@counted/ui/components/field";
export default function TextareaExample({
  variant = "default",
}: {
  variant?: string;
}) {
  const id = useId();
  const [value, setValue] = useState(
    variant === "empty" ? "" : "A shared space for the things worth measuring.",
  );
  return (
    <Field
      className="w-full max-w-sm"
      data-invalid={variant === "invalid" || undefined}
      data-disabled={variant === "disabled" || undefined}
    >
      <FieldLabel htmlFor={id}>Description</FieldLabel>
      <Textarea
        id={id}
        placeholder="Add a description…"
        disabled={variant === "disabled"}
        readOnly={variant === "read-only"}
        aria-invalid={variant === "invalid" || undefined}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={240}
        rows={4}
        aria-describedby={id + "-hint"}
      />
      <FieldDescription id={id + "-hint"}>
        {variant === "invalid"
          ? "Add a more specific description."
          : `${value.length} / 240 characters`}
      </FieldDescription>
    </Field>
  );
}
