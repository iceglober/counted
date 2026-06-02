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
