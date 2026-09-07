"use client";
import { useId } from "react";
import { RadioGroup, RadioGroupItem } from "@counted/ui/components/radio-group";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@counted/ui/components/field";
export default function RadioGroupExample({
  variant = "default",
}: {
  variant?: string;
}) {
  const id = useId();
  return (
    <FieldSet className="max-w-sm w-full">
      <FieldLegend>Default view</FieldLegend>
      <RadioGroup
        defaultValue="overview"
        disabled={variant === "disabled"}
        className={variant === "horizontal" ? "flex flex-wrap gap-5" : "gap-5"}
      >
        {[
          ["overview", "Overview", "Start with a summary of the collection."],
          ["detail", "Detail", "Open the last selected record."],
        ].map(([value, title, description]) => (
          <Field key={value} orientation="horizontal">
            <RadioGroupItem id={id + value} value={value!} />
            <FieldContent>
              <FieldLabel htmlFor={id + value}>{title}</FieldLabel>
              {variant === "with-description" && (
                <FieldDescription>{description}</FieldDescription>
              )}
            </FieldContent>
          </Field>
        ))}
      </RadioGroup>
    </FieldSet>
  );
}
