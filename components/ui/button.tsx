import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Themed with the app's own tokens (gold `accent` is the primary action), not
// shadcn's default palette. States follow ux-for-ai Ch.2 (a clear affordance per
// variant) and Ch.3 (hover/active/focus/disabled feedback). The press nudge and
// 150ms transition match the app's existing button feel so the swap is seamless.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium select-none transition-[background-color,border-color,color,transform,opacity] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-foreground hover:bg-accent-hover",
        secondary:
          "border border-border bg-transparent text-text-secondary hover:border-border-hover hover:text-text-primary",
        outline:
          "border border-border bg-surface-1 text-text-primary hover:border-border-hover hover:bg-surface-2",
        ghost: "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
        destructive: "bg-error text-surface-0 hover:bg-error/90",
        link: "text-accent underline-offset-4 hover:text-accent-hover hover:underline",
      },
      size: {
        sm: "h-8 rounded-md px-3 text-xs",
        default: "h-9 px-4 py-2",
        lg: "h-11 rounded-md px-6 text-base",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
