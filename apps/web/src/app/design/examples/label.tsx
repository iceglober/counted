"use client";
import { useId } from "react";
import { Label } from "@counted/ui/components/label";
import { Input } from "@counted/ui/components/input";
import { Checkbox } from "@counted/ui/components/checkbox";
export default function LabelExample({
  variant = "input",
}: {
  variant?: string;
}) {
  const id = useId();
  if (variant === "checkbox")
    return (
      <div className="flex items-center gap-3">
        <Checkbox id={id} />
        <Label htmlFor={id}>Include archived records</Label>
      </div>
    );
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <Label htmlFor={id}>
        Display name
        {variant === "required" && (
          <span className="text-muted-foreground">(required)</span>
        )}
      </Label>
      <Input
        id={id}
        required={variant === "required"}
        disabled={variant === "disabled"}
        placeholder="Click the label to focus this input"
      />
    </div>
  );
}
