"use client";
import { useId } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@counted/ui/components/select";

export type SelectOption = { value: string; label: string };
export function SelectControl({
  id,
  name,
  items,
  defaultValue,
  value,
  onValueChange,
  required,
  disabled,
  className,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  id?: string;
  name?: string;
  items: readonly SelectOption[];
  defaultValue?: string | number;
  value?: string | null;
  onValueChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const generatedId = useId();
  const initialValue =
    defaultValue === undefined
      ? (items[0]?.value ?? null)
      : String(defaultValue);
  return (
    <Select
      key={
        value === undefined
          ? `${id ?? generatedId}:${name}:${initialValue}`
          : generatedId
      }
      name={name}
      items={items}
      {...(value === undefined ? { defaultValue: initialValue } : { value })}
      onValueChange={(next) => {
        if (next !== null) onValueChange?.(next);
      }}
      required={required}
      disabled={disabled || items.length === 0}
    >
      <SelectTrigger
        id={id ?? generatedId}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        className={className ?? "w-full min-w-0"}
      >
        <SelectValue
          placeholder={
            items.find((item) => item.value === "")?.label ??
            (items.length ? "Choose an option" : "No options available")
          }
        />
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
  );
}
