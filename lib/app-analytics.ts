import { Analytics } from "@counted/sdk";

// App-side dogfood analytics (app.counted.dev). Shares the same project as the
// marketing site (NEXT_PUBLIC_COUNTED_PROJECT_KEY), so page_view + cta_click
// (marketing) and signup (here) form one funnel.
//
// Attribution arrives from the marketing site as URL params on the /login hop
// (cross-origin localStorage isn't shared — and we use URL params, never a
// cross-site cookie, per the privacy-first philosophy in AGENTS.md). We persist
// the first-touch values to app-origin localStorage so they survive /login →
// magic-link → /dashboards and get attached to the signup event.

let instance: Analytics | null = null;
let tried = false;

const ATTR_KEY = "counted_attr_v1";
const SIGNUP_FLAG = "counted_signup_fired";
const ATTR_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "channel",
  "referrer_host",
  "landing_path",
] as const;

function captureAttribution(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(ATTR_KEY);
    if (stored) return JSON.parse(stored) as Record<string, string>;

    const params = new URLSearchParams(window.location.search);
    const fromUrl: Record<string, string> = {};
    for (const k of ATTR_PARAMS) {
      const v = params.get(k);
      if (v) fromUrl[k] = v.slice(0, 120);
    }
    if (Object.keys(fromUrl).length > 0) {
      localStorage.setItem(ATTR_KEY, JSON.stringify(fromUrl));
      return fromUrl;
    }
    return {};
  } catch {
    return {};
  }
}

export function appAnalytics(): Analytics | null {
  if (tried) return instance;
  tried = true;
  const key = process.env.NEXT_PUBLIC_COUNTED_PROJECT_KEY;
  const host = process.env.NEXT_PUBLIC_COUNTED_HOST ?? "https://app.counted.dev";
  if (key) {
    instance = new Analytics({ projectKey: key, host, flushInterval: 5_000 });
    try {
      instance.register(captureAttribution());
    } catch {
      /* attribution is best-effort */
    }
  }
  return instance;
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
