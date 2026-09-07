/** Published hosted plans. Currency prices are confirmed in checkout. */
export const PUBLIC_PLANS = [
  { id: "free", name: "Free", monthlyUsd: 0, annualUsd: 0, eventsPerMonth: 100_000, projects: 3, retentionDays: 180 },
  { id: "pro", name: "Pro", monthlyUsd: 12, annualUsd: 120, eventsPerMonth: 1_000_000, projects: null, retentionDays: 730 },
] as const;
export const COMPARISONS = [
  { slug: "aptabase", name: "Aptabase", url: "https://aptabase.com", description: "Privacy-focused app analytics and Counted’s composable dashboards." },
  { slug: "counter", name: "Counter.dev", url: "https://counter.dev", description: "Two different products, one letter apart. Get to know Counted’s event model." },
  { slug: "plausible", name: "Plausible", url: "https://plausible.io", description: "Privacy-first analytics, with a closer look at Counted’s product analytics." },
  { slug: "posthog", name: "PostHog", url: "https://posthog.com", description: "Counted’s focused event analytics and composable dashboards." },
] as const;
