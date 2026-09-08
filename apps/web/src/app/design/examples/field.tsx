"use client";
import { useId } from "react";
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@counted/ui/components/field";
import { Input } from "@counted/ui/components/input";
import { Switch } from "@counted/ui/components/switch";
export default function FieldExample({
  variant = "vertical",
}: {
  variant?: string;
}) {
  const id = useId();
  const horizontal = variant === "horizontal" || variant === "responsive";
  return (
    <FieldGroup
      className={
        variant === "responsive" ? "w-full max-w-lg" : "w-full max-w-sm"
      }
    >
      <Field
        className="w-full"
        orientation={
          variant === "responsive"
            ? "responsive"
            : horizontal
              ? "horizontal"
              : "vertical"
        }
        data-disabled={variant === "disabled" || undefined}
        data-invalid={variant === "invalid" || undefined}
      >
        {horizontal ? (
          <>
            <FieldContent>
              <FieldLabel htmlFor={id}>Show in overview</FieldLabel>
              <FieldDescription>
                Include this record in the default view.
              </FieldDescription>
            </FieldContent>
            <Switch id={id} defaultChecked />
          </>
        ) : (
          <>
            <FieldLabel htmlFor={id}>Display name</FieldLabel>
            <Input
              id={id}
              defaultValue="acme-web"
              disabled={variant === "disabled"}
              aria-invalid={variant === "invalid" || undefined}
              aria-describedby={id + "-hint"}
            />
            {variant === "invalid" ? (
              <FieldError id={id + "-hint"}>
                A record already uses this name.
              </FieldError>
            ) : (
              <FieldDescription id={id + "-hint"}>
                Visible in lists and summaries.
              </FieldDescription>
            )}
          </>
        )}
      </Field>
    </FieldGroup>
  );
}
