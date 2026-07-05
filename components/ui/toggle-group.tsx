"use client";

import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

// Segmented control. The app uses this for the insight type-picker
// (metric / timeseries / breakdown / funnel / retention).
function ToggleGroup({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      {...props}
    />
  );
}

function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md border border-transparent bg-surface-2 px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors",
        "hover:text-text-primary",
        "data-[state=on]:border-accent/30 data-[state=on]:bg-accent/15 data-[state=on]:text-accent",
        "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
