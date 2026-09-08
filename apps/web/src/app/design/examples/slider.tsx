"use client";
import { useId, useState } from "react";
import { Slider } from "@counted/ui/components/slider";
import { Field, FieldTitle } from "@counted/ui/components/field";
export default function SliderExample({
  variant = "single",
}: {
  variant?: string;
}) {
  const id = useId();
  const [value, setValue] = useState<number | number[]>(
    variant === "range" ? [20, 80] : 60,
  );
  return (
    <Field
      className="w-full max-w-sm"
      data-disabled={variant === "disabled" || undefined}
    >
      <div className="flex justify-between gap-4">
        <FieldTitle id={id}>
          {variant === "range" ? "Visible range" : "Density"}
        </FieldTitle>
        <output className="text-xs tabular-nums text-muted-foreground">
          {Array.isArray(value) ? value.join(" – ") : value}%
        </output>
      </div>
      <div className={variant === "vertical" ? "h-44 self-center" : "w-full"}>
        <Slider
          aria-labelledby={id}
          value={value}
          onValueChange={(next) =>
            setValue(typeof next === "number" ? next : [...next])
          }
          orientation={variant === "vertical" ? "vertical" : "horizontal"}
          disabled={variant === "disabled"}
        />
      </div>
    </Field>
  );
}
