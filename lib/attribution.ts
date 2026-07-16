import { Analytics } from "@counted/sdk";

// Shared attribution contract for both dogfood surfaces (marketing site +
// app). First-touch attribution is captured within a single visit only and
// stored in sessionStorage — nothing survives the visit. Per the privacy-first
// philosophy we never persist across visits (no cookies, no cross-visit
// identity, even for attribution); the cross-origin /login handoff carries
// attribution as explicit URL params, so persistence isn't needed.

export type Attribution = Record<string, string>;

export const ATTR_KEY = "counted_attr_v1";

// Max stored length for any single attribution value.
export const MAX_VAL = 120;

// UTM params captured from the landing URL.
export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

// Every attribution param carried across the cross-origin /login hop.
export const ATTR_PARAMS = [
  ...UTM_KEYS,
  "channel",
  "referrer_host",
  "landing_path",
] as const;

// Read first-touch attribution stored for THIS visit, or null if none/SSR.
export function readStoredAttribution(): Attribution | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = sessionStorage.getItem(ATTR_KEY);
    return stored ? (JSON.parse(stored) as Attribution) : null;
  } catch {
    return null;
  }
}

// Persist first-touch attribution for the remainder of THIS visit only.
export function persistAttribution(attr: Attribution): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(ATTR_KEY, JSON.stringify(attr));
  } catch {
    /* private mode / storage disabled — best-effort */
  }
}

let instance: Analytics | null = null;
let tried = false;

// Lazily create the browser Analytics client from the shared project key,
// registering attribution as super-properties so every event carries
// source/medium/campaign/channel. No-op (returns null) if the key is unset or
// during SSR. A given page is either the marketing site or the app, so the
// module-level singleton is created once per browser context.
export function lazyAnalytics(
  getAttribution: () => Attribution,
  opts?: { flushInterval?: number },
): Analytics | null {
  if (tried) return instance;
  tried = true;
  const key = process.env.NEXT_PUBLIC_COUNTED_PROJECT_KEY;
  const host = process.env.NEXT_PUBLIC_COUNTED_HOST ?? "https://app.counted.dev";
  if (key) {
    instance = new Analytics({
      projectKey: key,
      host,
      ...(opts?.flushInterval ? { flushInterval: opts.flushInterval } : {}),
    });
    try {
      instance.register(getAttribution());
    } catch {
      /* attribution is best-effort */
    }
  }
  return instance;
}
