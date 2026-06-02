"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// Counted's signature tooltip: it FOLLOWS the cursor and is tinted with the
// accent. Portals to <body> so a transformed ancestor (grid card) can't trap it.
// Wrap any trigger: <Tooltip label="Configure"><IconButton .../></Tooltip>.
export function Tooltip({
  label,
  tone = "accent",
  className,
  children,
}: {
  label: string;
  tone?: "accent" | "danger" | "neutral";
  className?: string;
  children: ReactNode;
}) {
  const [hovering, setHovering] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const tip =
    tone === "danger"
      ? "text-error border-error/20"
      : tone === "neutral"
        ? "text-text-primary border-border"
        : "text-accent border-accent/20";

  return (
    <span
      className={cn("inline-flex", className)}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
    >
      {children}
      {hovering &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{ position: "fixed", left: pos.x + 12, top: pos.y - 8, pointerEvents: "none", zIndex: 99999 }}
            className={cn("rounded border bg-surface-2 px-2 py-1 text-xs font-medium whitespace-nowrap shadow-sm", tip)}
          >
            {label}
          </div>,
          document.body,
        )}
    </span>
  );
}
