/** Public destinations are deployment URLs, never request-derived credentials. */
const cleanOrigin = (raw: string) => new URL(raw).origin;
export const siteOrigin = (env: Readonly<Record<string, string | undefined>> = process.env) => cleanOrigin(env.COUNTED_SITE_URL ?? "https://counted.dev");
export const docsOrigin = (env: Readonly<Record<string, string | undefined>> = process.env) => cleanOrigin(env.COUNTED_DOCS_URL ?? "https://docs.counted.dev");
export const publicApiOrigin = (env: Readonly<Record<string, string | undefined>> = process.env) => cleanOrigin(env.COUNTED_PUBLIC_API_URL ?? "https://api.counted.dev");
export const isSiteHost = (host: string | null, env: Readonly<Record<string, string | undefined>> = process.env): boolean => {
  if (host === null || /[\s,/@\\]/.test(host)) return false;
  const normalized = host.toLowerCase().replace(/\.$/, "");
  const configured = new URL(siteOrigin(env)).host.toLowerCase();
  return normalized === configured || (!env.COUNTED_SITE_URL && normalized === "www.counted.dev");
};
export const PUBLIC_PATHS = ["/", "/pricing", "/about", "/contact", "/privacy", "/terms", "/blog", "/for/agents", "/vs", "/vs/aptabase", "/vs/counter", "/vs/plausible", "/vs/posthog"] as const;
