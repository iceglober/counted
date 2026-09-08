"use client";
import { useId } from "react";
import { Switch } from "@counted/ui/components/switch";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@counted/ui/components/field";
export default function SwitchExample({
  variant = "checked",
}: {
  variant?: string;
}) {
  const id = useId();
  return (
    <Field
      className="w-full max-w-sm"
      orientation="horizontal"
      data-disabled={variant === "disabled" || undefined}
    >
      <FieldContent>
        <FieldLabel htmlFor={id}>Compact view</FieldLabel>
        {variant === "with-description" && (
          <FieldDescription>Show more rows in the same space.</FieldDescription>
        )}
      </FieldContent>
      <Switch
        id={id}
        size={variant === "small" ? "sm" : "default"}
        defaultChecked={variant !== "unchecked"}
        disabled={variant === "disabled"}
      />
    </Field>
  );
}
