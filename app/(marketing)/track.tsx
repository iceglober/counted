"use client";

import { useEffect } from "react";
import Link from "next/link";
import { track } from "./analytics";

// Client-side tracking primitives for the marketing pages. Attribution (UTM +
// referrer) is attached to every event automatically by analytics.ts, so these
// only need to name the event and a little context.

// Fires a page_view once on mount. Drop one at the top of each marketing page.
export function PageView({ name }: { name: string }) {
  useEffect(() => {
    track("page_view", { page: name });
  }, [name]);
  return null;
}

// A Link that records a cta_click before navigating. Use for conversion CTAs
// (Start free / Create a project) so the source → signup funnel is attributable.
export function TrackedCTA({
  href,
  location,
  label,
  variant = "primary",
  className,
  children,
}: {
  href: string;
  location: string;
  label: string;
  variant?: "primary" | "secondary";
  className?: string;
  children: React.ReactNode;
}) {
  const base =
    variant === "primary"
      ? "bg-accent text-surface-0 hover:bg-accent-hover"
      : "border border-border text-text-secondary hover:border-border-hover hover:text-text-primary";
  return (
    <Link
      href={href}
      onClick={() => track("cta_click", { location, label, variant })}
      className={
        className ??
        `inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-medium active:translate-y-px transition-[background-color,border-color,color,transform] duration-150 ${base}`
      }
    >
      {children}
    </Link>
  );
}
