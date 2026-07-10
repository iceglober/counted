import * as React from "react";
import { cn } from "@/lib/utils";

// Retro text field: white face, classic 2px inset bevel, square corners.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-8 w-full border-2 border-surface-3 [border-style:inset] bg-surface-0 px-2 py-1 text-sm text-text-primary",
        "placeholder:text-text-tertiary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text-primary",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
