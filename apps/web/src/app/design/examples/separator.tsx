"use client";
import { Separator } from "@counted/ui/components/separator";
export default function SeparatorExample({
  variant = "horizontal",
}: {
  variant?: string;
}) {
  if (variant === "vertical")
    return (
      <div className="flex h-5 items-center gap-5 text-sm">
        <span>Overview</span>
        <Separator orientation="vertical" />
        <span>Activity</span>
      </div>
    );
  return (
    <div className="flex w-full max-w-sm flex-col gap-5">
      <p className="font-heading text-lg">A little room to breathe.</p>
      <Separator />
      <p className="text-sm text-muted-foreground">
        Rules separate groups without competing for attention.
      </p>
    </div>
  );
}
