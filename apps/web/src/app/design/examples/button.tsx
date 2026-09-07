"use client";
import { IconArrowUpRight, IconPlus } from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import { toast } from "@counted/ui/components/toast";
export default function ButtonExample({
  variant = "default",
}: {
  variant?: string;
}) {
  const appearance = [
    "outline",
    "secondary",
    "ghost",
    "destructive",
    "link",
  ].includes(variant)
    ? (variant as "outline" | "secondary" | "ghost" | "destructive" | "link")
    : "default";
  const size = [
    "xs",
    "sm",
    "lg",
    "icon",
    "icon-xs",
    "icon-sm",
    "icon-lg",
  ].includes(variant)
    ? (variant as
        "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg")
    : "default";
  const iconOnly = size.startsWith("icon");
  return (
    <Button
      variant={appearance}
      size={size}
      disabled={variant === "disabled"}
      aria-label={iconOnly ? "Add a record" : undefined}
      onClick={() =>
        toast.add({
          title: "Action received",
          description: "This is a local preview.",
          type: "success",
        })
      }
    >
      {iconOnly ? (
        <IconPlus />
      ) : (
        <>
          {variant === "destructive" ? "Remove record" : "Create record"}
          {variant === "with-icon" && (
            <IconArrowUpRight data-icon="inline-end" />
          )}
        </>
      )}
    </Button>
  );
}
