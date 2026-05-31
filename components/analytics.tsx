"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Analytics } from "@counted/sdk";

const APP_KEY = process.env.NEXT_PUBLIC_COUNTED_APP_KEY;

export function CountedAnalytics() {
  const analyticsRef = useRef<Analytics | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!APP_KEY) return;
    if (!analyticsRef.current) {
      analyticsRef.current = new Analytics({
        appKey: APP_KEY,
        host: process.env.NEXT_PUBLIC_COUNTED_HOST ?? "https://app.counted.dev",
      });
    }
  }, []);

  useEffect(() => {
    analyticsRef.current?.track("page_view", { path: pathname });
  }, [pathname]);

  return null;
}
