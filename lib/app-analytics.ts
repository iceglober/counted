import { Analytics } from "@counted/sdk";
import {
  ATTR_PARAMS,
  MAX_VAL,
  readStoredAttribution,
  persistAttribution,
  lazyAnalytics,
} from "@/lib/attribution";

// App-side dogfood analytics (app.counted.dev). Shares the same project as the
// marketing site (NEXT_PUBLIC_COUNTED_PROJECT_KEY), so page_view + cta_click
// (marketing) and signup (here) form one funnel.
//
// Attribution arrives from the marketing site as URL params on the /login hop
// (cross-origin storage isn't shared — and we use URL params, never a
// cross-site cookie, per the privacy-first philosophy in AGENTS.md). We keep
// the first-touch values in app-origin sessionStorage so they survive /login →
// magic-link → /dashboards within the visit and get attached to the signup
// event — nothing persists across visits.

const SIGNUP_FLAG = "counted_signup_fired";

function captureAttribution(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const stored = readStoredAttribution();
  if (stored) return stored;

  const params = new URLSearchParams(window.location.search);
  const fromUrl: Record<string, string> = {};
  for (const k of ATTR_PARAMS) {
    const v = params.get(k);
    if (v) fromUrl[k] = v.slice(0, MAX_VAL);
  }
  if (Object.keys(fromUrl).length > 0) {
    persistAttribution(fromUrl);
    return fromUrl;
  }
  return {};
}

export function appAnalytics(): Analytics | null {
  return lazyAnalytics(captureAttribution, { flushInterval: 5_000 });
}

export function trackApp(event: string, props?: Record<string, string | number | boolean>) {
  try {
    appAnalytics()?.track(event, props);
  } catch {
    /* analytics must never break the app */
  }
}

// Fire signup once per browser. Mounted in the authenticated (app) layout, so it
// only runs for a signed-in user; the flag keeps it to one event. Attribution is
// already registered, so the event carries source/medium/campaign/channel.
//
// Note: this is an activation proxy (first authenticated app load per browser),
// not a precise account-creation hook. A server-side better-auth user.create
// hook would be exact — tracked as a follow-up in the internal HANDOFF.
export function markSignupOnce(props?: Record<string, string | number | boolean>) {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(SIGNUP_FLAG)) return;
    localStorage.setItem(SIGNUP_FLAG, "1");
    trackApp("signup", props);
  } catch {
    /* private mode / storage disabled */
  }
}
