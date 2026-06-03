import { Analytics } from "@counted/sdk";

// Counted dogfooding its own marketing site. Lazily creates the client browser
// SDK from NEXT_PUBLIC_COUNTED_PROJECT_KEY (no-op if unset). Only call from
// client handlers/effects so the instance is created in the browser, never
// during SSR.
//
// On first creation it captures first-touch attribution (UTM tags + referrer)
// and registers it as super-properties, so every marketing event — page_view,
// cta_click, etc. — carries source/medium/campaign/channel. That's the read
// side of the Growth dashboard (source → conversion).

let instance: Analytics | null = null;
let tried = false;

const ATTR_KEY = "counted_attr_v1";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

export type Attribution = Record<string, string>;

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
      if (v) attr[k] = v.slice(0, 120);
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

// First-touch: persist the first attribution we ever see for this browser and
// keep it stable across pages and later visits.
export function getAttribution(): Attribution {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(ATTR_KEY);
    if (stored) return JSON.parse(stored) as Attribution;
    const attr = computeAttribution();
    localStorage.setItem(ATTR_KEY, JSON.stringify(attr));
    return attr;
  } catch {
    return computeAttribution();
  }
}

// Append first-touch attribution to an outbound link as explicit URL params.
// Used on the login CTA so attribution survives the cross-origin hop to the app
// (counted.dev → app.counted.dev), where localStorage isn't shared. URL params,
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

function client(): Analytics | null {
  if (tried) return instance;
  tried = true;
  const key = process.env.NEXT_PUBLIC_COUNTED_PROJECT_KEY;
  const host = process.env.NEXT_PUBLIC_COUNTED_HOST ?? "https://app.counted.dev";
  if (key) {
    instance = new Analytics({ projectKey: key, host });
    try {
      instance.register(getAttribution());
    } catch {
      /* attribution is best-effort */
    }
  }
  return instance;
}

export function track(event: string, props?: Record<string, string | number | boolean>) {
  try {
    client()?.track(event, props);
  } catch {
    /* analytics must never break the page */
  }
}

// Assign a sticky A/B variant for an experiment. The bucket is persisted in
// first-party localStorage (a non-identifying value — allowed by the privacy
// philosophy; never a tracking cookie). The variant is registered as the
// `exp_<name>` super-property, so every subsequent event (cta_click, …) carries
// it and the dogfood dashboard can split the funnel by variant. Call from a
// client effect, then fire an explicit `experiment_view` exposure event.
export function assignExperiment<T extends string>(name: string, variants: readonly T[]): T {
  const key = `counted_exp_${name}`;
  let v: T | null = null;
  try {
    const stored = localStorage.getItem(key) as T | null;
    if (stored && variants.includes(stored)) v = stored;
    if (!v) {
      v = variants[Math.floor(Math.random() * variants.length)];
      localStorage.setItem(key, v);
    }
  } catch {
    // private mode / no storage — assign for this render, don't persist
    v = variants[Math.floor(Math.random() * variants.length)];
  }
  try {
    client()?.register({ [`exp_${name}`]: v });
  } catch {
    /* super-property is best-effort */
  }
  return v;
}
