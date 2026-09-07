"use client";
import { IconBookmark } from "@tabler/icons-react";
import { Toggle } from "@counted/ui/components/toggle";
export default function ToggleExample({
  variant = "default",
}: {
  variant?: string;
}) {
  return (
    <Toggle
      aria-label="Bookmark"
      variant={variant === "outline" ? "outline" : "default"}
      size={variant === "sm" || variant === "lg" ? variant : "default"}
      defaultPressed={variant === "pressed"}
      disabled={variant === "disabled"}
    >
      <IconBookmark />
      {variant === "with-label" && "Bookmark"}
    </Toggle>
  );
}
