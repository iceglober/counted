"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { appAnalytics, trackApp } from "@/lib/app-analytics";

export function CountedAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    // Ensure the client is created and first-touch attribution is captured +
    // registered (it reads URL params on the /login landing), then track the view.
    appAnalytics();
    trackApp("page_view", { path: pathname });
  }, [pathname]);

  return null;
}
