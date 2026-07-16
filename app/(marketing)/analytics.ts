import {
  MAX_VAL,
  UTM_KEYS,
  type Attribution,
  readStoredAttribution,
  persistAttribution,
  lazyAnalytics,
} from "@/lib/attribution";

// Counted dogfooding its own marketing site. Lazily creates the client browser
// SDK from NEXT_PUBLIC_COUNTED_PROJECT_KEY (no-op if unset). Only call from
// client handlers/effects so the instance is created in the browser, never
// during SSR.
//
// On first creation it captures first-touch attribution (UTM tags + referrer)
// and registers it as super-properties, so every marketing event — page_view,
// cta_click, etc. — carries source/medium/campaign/channel. That's the read
// side of the Growth dashboard (source → conversion). First-touch is scoped to
// the visit (sessionStorage) — nothing persists across visits, per the
// privacy-first, never-persist policy.

export type { Attribution };

// Group a referrer host into a coarse channel for the source dimension.
function channelFromHost(host: string): string {
  const h = host.toLowerCase();
  if (h.includes("google")) return "google";
  if (h.includes("bing")) return "bing";
  if (h.includes("duckduckgo")) return "duckduckgo";
  if (h.includes("ycombinator")) return "hackernews";
  if (h.includes("reddit")) return "reddit";
  if (h === "t.co" || h.includes("twitter") || h.includes("x.com")) return "twitter";
  if (h.includes("github")) return "github";
  if (h.includes("dev.to")) return "devto";
  if (h.includes("news.")) return "news";
  return "referral";
}

function computeAttribution(): Attribution {
  const attr: Attribution = {};
  try {
    const params = new URLSearchParams(window.location.search);
    for (const k of UTM_KEYS) {
      const v = params.get(k);
      if (v) attr[k] = v.slice(0, MAX_VAL);
    }

    let refHost = "";
    try {
      refHost = document.referrer ? new URL(document.referrer).hostname : "";
    } catch {
      /* malformed referrer */
    }
    const external = refHost && !refHost.endsWith("counted.dev");
    if (external) attr.referrer_host = refHost;

    attr.channel = attr.utm_source ?? (external ? channelFromHost(refHost) : "direct");
    attr.landing_path = window.location.pathname;
  } catch {
    attr.channel = "direct";
  }
  return attr;
}

// First-touch: remember the first attribution we see this visit and keep it
// stable across pages within the visit (sessionStorage). Nothing survives the
// visit — the cross-origin /login handoff carries attribution via URL params.
export function getAttribution(): Attribution {
  if (typeof window === "undefined") return {};
  const stored = readStoredAttribution();
  if (stored) return stored;
  const attr = computeAttribution();
  persistAttribution(attr);
  return attr;
}

// Append first-touch attribution to an outbound link as explicit URL params.
// Used on the login CTA so attribution survives the cross-origin hop to the app
// (counted.dev → app.counted.dev), where storage isn't shared. URL params,
// never a cross-site cookie — per the privacy-first philosophy (AGENTS.md).
export function appendAttribution(href: string): string {
  if (typeof window === "undefined") return href;
  try {
    const attr = getAttribution();
    if (Object.keys(attr).length === 0) return href;
    const [path, existing] = href.split("?");
    const qs = new URLSearchParams(existing ?? "");
    for (const [k, v] of Object.entries(attr)) qs.set(k, String(v));
    return `${path}?${qs.toString()}`;
  } catch {
    return href;
  }
}

export function track(event: string, props?: Record<string, string | number | boolean>) {
  try {
    lazyAnalytics(getAttribution)?.track(event, props);
  } catch {
    /* analytics must never break the page */
  }
}
