"use client";
import { useId, useState } from "react";
import { Label } from "@counted/ui/components/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@counted/ui/components/select";
import { Preview } from "./preview";

export function VariantPreview({
  label,
  code,
  variants,
}: {
  label: string;
  code: string;
  variants: { value: string; label: string; example: React.ReactNode }[];
}) {
  const id = useId();
  const [value, setValue] = useState(variants[0]!.value);
  const selected =
    variants.find((item) => item.value === value) ?? variants[0]!;
  return (
    <Preview
      label={label}
      code={code}
      controls={
        <div className="variant-control">
          <Label htmlFor={id}>Variant</Label>
          <Select
            items={variants.map(({ value, label }) => ({ value, label }))}
            value={selected.value}
            onValueChange={(next) => {
              if (next) setValue(next);
            }}
          >
            <SelectTrigger
              id={id}
              size="sm"
              aria-label="Preview variant"
              className="w-44 max-w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="end">
              <SelectGroup>
                {variants.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      }
    >
      <div
        key={selected.value}
        data-preview-variant={selected.value}
        className="flex w-full min-w-0 items-center justify-center"
      >
        {selected.example}
      </div>
    </Preview>
  );
}
