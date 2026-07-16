import type { RawEvent } from "./types";

// Warn at most once per distinct HTTP status (401/403 always warn — they mean
// permanent misconfiguration a developer must fix).
const warnedStatuses = new Set<number>();

export function sendBeacon(url: string, events: RawEvent[]): boolean {
  if (typeof globalThis.navigator?.sendBeacon === "function") {
    const blob = new Blob([JSON.stringify(events)], {
      type: "application/json",
    });
    return globalThis.navigator.sendBeacon(url, blob);
  }
  return false;
}

export type SendResult = {
  ok: boolean;
  /** HTTP status, or 0 for a network error / no response. */
  status: number;
  /** Seconds to wait, parsed from a 429 `Retry-After` header. */
  retryAfter?: number;
};

export async function sendFetch(
  url: string,
  events: RawEvent[],
  projectKey: string,
  opts: { debug?: boolean } = {},
): Promise<SendResult> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Project-Key": projectKey,
      },
      body: JSON.stringify(events.length === 1 ? events[0] : events),
      keepalive: true,
    });

    if (!response.ok) {
      // Surface the server's error body instead of swallowing it.
      let detail = "";
      try {
        detail = (await response.text()).slice(0, 500);
      } catch {
        /* ignore body read errors */
      }

      const always = response.status === 401 || response.status === 403;
      if (always || !warnedStatuses.has(response.status)) {
        warnedStatuses.add(response.status);
        console.warn(
          `[counted] event ingestion failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
        );
      }

      let retryAfter: number | undefined;
      if (response.status === 429) {
        const header = response.headers.get("Retry-After");
        const parsed = header ? Number(header) : NaN;
        if (Number.isFinite(parsed) && parsed >= 0) retryAfter = parsed;
      }

      return { ok: false, status: response.status, retryAfter };
    }

    if (opts.debug) {
      console.log(`[counted] flushed ${events.length} event(s)`);
    }
    return { ok: true, status: response.status };
  } catch (err) {
    if (opts.debug) {
      console.warn("[counted] network error during flush", err);
    }
    return { ok: false, status: 0 };
  }
}
