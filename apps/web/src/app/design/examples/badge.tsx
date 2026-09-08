"use client";
import { IconCheck } from "@tabler/icons-react";
import { Badge } from "@counted/ui/components/badge";
export default function BadgeExample({
  variant = "default",
}: {
  variant?: string;
}) {
  const style =
    variant === "with-icon"
      ? "success"
      : (variant as
          | "default"
          | "secondary"
          | "outline"
          | "success"
          | "warning"
          | "destructive"
          | "ghost"
          | "link");
  const text =
    style === "success"
      ? "Active"
      : style === "warning"
        ? "Pending"
        : style === "destructive"
          ? "Failed"
          : style === "outline"
            ? "Archived"
            : "12 records";
  return (
    <Badge variant={style}>
      {variant === "with-icon" && <IconCheck />}
      {text}
    </Badge>
  );
}
