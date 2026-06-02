"use client";

import { type ReactNode } from "react";
import { IconButton } from "@/components/ui/icon-button";

// Re-based on the library IconButton (cursor-following accent tooltip + gold
// hover). Kept as a thin alias so existing call sites — which pass their own
// chip styling via className — don't need to change. New code should import
// IconButton directly.
type Props = {
  label: string;
  onClick: () => void;
  icon: ReactNode;
  className?: string;
};

export function ActionButton({ label, onClick, icon, className }: Props) {
  return <IconButton icon={icon} label={label} onClick={onClick} className={className} />;
}
