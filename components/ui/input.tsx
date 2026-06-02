import * as React from "react";
import { cn } from "@/lib/utils";

// Native input themed with app tokens. Focus lifts the border to the accent and
// adds a soft accent ring (ux-for-ai Ch.3: clear "you're here" feedback).
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full rounded-md border border-border bg-surface-1 px-3 py-1 text-sm text-text-primary transition-colors",
        "placeholder:text-text-tertiary",
        "focus-visible:outline-none focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/25",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text-primary",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
