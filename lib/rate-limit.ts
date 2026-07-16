const WINDOW_MS = 1_000;
const MAX_REQUESTS = 100;

type WindowEntry = {
  count: number;
  resetAt: number;
};

const windows = new Map<string, WindowEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of windows) {
    if (entry.resetAt < now) {
      windows.delete(ip);
    }
  }
}, 60_000);

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = windows.get(key);

  if (!entry || entry.resetAt < now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  entry.count++;
  if (entry.count > max) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
  }

  return { allowed: true };
}

export function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  return rateLimit(ip, MAX_REQUESTS, WINDOW_MS);
}

// Derive a trusted client IP for rate-limiting. The leftmost X-Forwarded-For
// entry is client-supplied and trivially spoofable, so rotating a fake XFF header
// would defeat per-IP limits. Prefer Cloudflare's CF-Connecting-IP; otherwise
// trust only the RIGHTMOST XFF entry (appended by our own edge/proxy), never the
// leftmost. This IP is used transiently for rate-limit keys only — never stored.
export function getClientIp(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;

  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return headers.get("x-real-ip")?.trim() ?? "unknown";
}
