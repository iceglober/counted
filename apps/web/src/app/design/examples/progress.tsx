"use client";
import { useState } from "react";
import { Button } from "@counted/ui/components/button";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@counted/ui/components/progress";
export default function ProgressExample({
  variant = "determinate",
}: {
  variant?: string;
}) {
  const [value, setValue] = useState(
    variant === "complete" ? 100 : variant === "empty" ? 0 : 64,
  );
  return (
    <div className="flex w-full max-w-sm flex-col gap-7">
      <Progress value={variant === "indeterminate" ? null : value}>
        <ProgressLabel>Import progress</ProgressLabel>
        {variant !== "indeterminate" && <ProgressValue />}
      </Progress>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {variant === "indeterminate"
          ? "Preparing records…"
          : value === 100
            ? "All records are ready."
            : `${value} of 100 records processed.`}
      </p>
      {variant !== "indeterminate" && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={value === 100}
            onClick={() => setValue(Math.min(100, value + 12))}
          >
            Advance
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setValue(0)}>
            Reset
          </Button>
        </div>
      )}
    </div>
  );
}
