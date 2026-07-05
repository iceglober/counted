import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Retro system-style buttons: gray face, 2px bevel (outset; inset when
// pressed), square corners. Variants keep their old API — the bevel is the
// affordance; weight and text color distinguish intent.
const BEVEL =
  "bg-surface-2 text-text-primary border-2 border-surface-3 [border-style:outset] active:[border-style:inset]";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: `${BEVEL} font-bold`,
        secondary: BEVEL,
        outline: BEVEL,
        ghost: "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
        destructive: `${BEVEL} text-error font-bold`,
        link: "text-accent underline hover:text-accent-hover",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        default: "h-9 px-4 py-2",
        lg: "h-11 px-6 text-base",
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
