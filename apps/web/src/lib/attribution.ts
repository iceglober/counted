import { Counted } from "@counted/sdk-js";

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

let instance: Counted | null = null;
let tried = false;

// Lazily create the browser Analytics client from the shared project key,
// registering attribution as super-properties so every event carries
// source/medium/campaign/channel. No-op (returns null) if the key is unset or
// during SSR. A given page is either the marketing site or the app, so the
// module-level singleton is created once per browser context.
/**
 * The client, created once, in the browser.
 *
 * v2's `Counted` has no `register()` — there are no super-properties. That is
 * deliberate in the SDK, and it means attribution has to be merged into each
 * event's own properties instead. `attributedTrack` below does that, so no
 * caller has to remember.
 */
export function lazyAnalytics(opts?: { flushIntervalMs?: number }): Counted | null {
  if (tried) return instance;
  tried = true;
  const key = process.env.NEXT_PUBLIC_COUNTED_PROJECT_KEY;
  const endpoint = process.env.NEXT_PUBLIC_COUNTED_API_URL ?? "https://api.counted.dev/v1/events";
  if (key) {
    instance = new Counted({
      key,
      endpoint,
      ...(opts?.flushIntervalMs === undefined ? {} : { flushIntervalMs: opts.flushIntervalMs }),
    });
  }
  return instance;
}

/**
 * Track with first-touch attribution folded in.
 *
 * Every marketing event carries source/medium/campaign/channel, which is the
 * read side of the Growth dashboard. Merged per event rather than registered
 * once, because v2 has no super-properties — and merging is the honest shape
 * anyway: what the event carried is visible in the event.
 */
export function attributedTrack(
  getAttribution: () => Attribution,
  event: string,
  props?: Record<string, string | number | boolean | null>,
): void {
  const counted = lazyAnalytics();
  if (counted === null) return;
  let attribution: Attribution = {};
  try {
    attribution = getAttribution();
  } catch {
    /* attribution is best-effort; the event still goes */
  }
  counted.track(event, { ...attribution, ...props });
}
