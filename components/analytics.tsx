"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Analytics } from "@counted/sdk";

export function CountedAnalytics() {
  const analyticsRef = useRef<Analytics | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_COUNTED_PROJECT_KEY;
    const host = process.env.NEXT_PUBLIC_COUNTED_HOST ?? "https://app.counted.dev";

    if (!key) {
      console.debug("[counted] NEXT_PUBLIC_COUNTED_PROJECT_KEY not set, skipping analytics");
      return;
    }

    if (!analyticsRef.current) {
      analyticsRef.current = new Analytics({ projectKey: key, host });
      console.debug("[counted] Analytics initialized", { key: key.slice(0, 10) + "...", host });
    }

    analyticsRef.current.track("page_view", { path: pathname });
  }, [pathname]);

  return null;
}
