"use client";
import { Skeleton } from "@counted/ui/components/skeleton";
export default function SkeletonExample({
  variant = "card",
}: {
  variant?: string;
}) {
  return (
    <div
      className="flex w-full max-w-sm flex-col gap-7"
      role="status"
      aria-label="Loading record"
    >
      {variant !== "text" && (
        <div className="flex items-center gap-4">
          <Skeleton className="size-10 shrink-0" />
          <div className="flex flex-1 flex-col gap-3">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      )}
      {variant === "card" && <Skeleton className="h-28 w-full" />}
      {variant !== "row" && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      )}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
