"use client";

import { useEffect } from "react";
import { markSignupOnce } from "@/lib/app-analytics";

// Mounted in the authenticated (app) layout, so it only runs for a signed-in
// user. Fires the `signup` event once per browser, carrying the attribution
// registered by appAnalytics() — closing the source → signup funnel.
export function SignupTracker() {
  useEffect(() => {
    markSignupOnce();
  }, []);
  return null;
}
