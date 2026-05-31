"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Analytics } from "@counted/sdk";

const PROJECT_KEY = process.env.NEXT_PUBLIC_COUNTED_PROJECT_KEY;

export function CountedAnalytics() {
  const analyticsRef = useRef<Analytics | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!PROJECT_KEY) return;
    if (!analyticsRef.current) {
      analyticsRef.current = new Analytics({
        projectKey: PROJECT_KEY,
        host: process.env.NEXT_PUBLIC_COUNTED_HOST ?? "https://app.counted.dev",
      });
    }
  }, []);

  useEffect(() => {
    analyticsRef.current?.track("page_view", { path: pathname });
  }, [pathname]);

  return null;
}
