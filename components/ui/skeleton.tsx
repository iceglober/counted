import { cn } from "@/lib/utils";

// Loading placeholder — a soft pulsing surface block. Use to reserve layout so
// content doesn't jump when it arrives (ux-for-ai Ch.3: show the system working).
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("animate-pulse rounded-md bg-surface-2", className)} {...props} />;
}

export { Skeleton };
