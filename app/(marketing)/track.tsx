"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { track, appendAttribution } from "./analytics";

// Client-side tracking primitives for the marketing pages. Attribution (UTM +
// referrer) is attached to every event automatically by analytics.ts, so these
// only need to name the event and a little context.
//
// Note: page_view is emitted once per route by the global CountedAnalytics
// (components/analytics.tsx) with a `path` prop — there is intentionally no
// separate marketing page_view here, to avoid double-counting.

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
  // For app-bound links (e.g. /login), forward first-touch attribution as URL
  // params after mount so it survives the cross-origin hop. SSR renders the bare
  // href (no hydration mismatch); the effect enhances it client-side.
  const [resolved, setResolved] = useState(href);
  useEffect(() => {
    if (href.startsWith("/login")) setResolved(appendAttribution(href));
  }, [href]);

  return (
    <Link
      href={resolved}
      onClick={() => track("cta_click", { location, label, variant })}
      className={className ?? (variant === "primary" ? "btn" : undefined)}
    >
      {children}
    </Link>
  );
}
