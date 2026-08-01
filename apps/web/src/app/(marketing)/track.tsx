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
  // For app-bound links, forward first-touch attribution as URL params after
  // mount so it survives the hop into the console. SSR renders the bare href
  // (no hydration mismatch); the effect enhances it client-side.
  //
  // Matched against the real route. This tested `/login`, which no route has
  // ever served — so every marketing CTA pointed at a 404, and the attribution
  // that only fires for app-bound links fired for none of them. Both failures
  // came from one stale literal.
  const [resolved, setResolved] = useState(href);
  useEffect(() => {
    if (href.startsWith("/sign-in")) setResolved(appendAttribution(href));
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
