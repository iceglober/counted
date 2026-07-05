"use client";

import { type ReactNode, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "./tooltip";

// Counted's primary action: an icon-only button that rests muted, lifts to the
// accent on hover, paired with the cursor-following accent tooltip. Formalizes
// the old ActionButton.
type Props = {
  icon: ReactNode;
  label: string;
  /** Hover/tooltip emphasis. "accent" (default) → iris; "danger" → error red. */
  tone?: "accent" | "danger";
  className?: string;
} & Omit<ComponentProps<"button">, "className">;

export function IconButton({ icon, label, tone = "accent", className, ...props }: Props) {
  const hover =
    tone === "danger"
      ? "hover:text-error hover:border-error/40"
      : "hover:text-accent hover:border-accent/40";

  return (
    <Tooltip label={label} tone={tone}>
      <button
        {...props}
        aria-label={label}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-md border border-transparent text-text-tertiary transition-[color,background-color,border-color,transform] duration-150 active:translate-y-px hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
          hover,
          className,
        )}
      >
        {icon}
      </button>
    </Tooltip>
  );
}
