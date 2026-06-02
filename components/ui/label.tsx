"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

// The app's form labels are small uppercase eyebrows — keep that as the default
// so swaps stay visually continuous. Radix Label gives click-to-focus + disabled
// propagation for free.
function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "text-xs font-medium uppercase tracking-wider text-text-secondary select-none",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
