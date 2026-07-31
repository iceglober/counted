/**
 * Sending a batch.
 *
 * Two things are new here, and both come from the server finally telling the
 * truth about what happened.
 *
 * **Retryability is read, not guessed.** v1 retried any non-2xx, so a 400 for
 * a malformed batch was resent four times unchanged and a 401 for a revoked
 * key was retried until the buffer filled. The v2 error envelope carries
 * `retryable`, so the SDK stops when resending cannot help.
 *
 * **A 202 is a receipt.** v1's ingest returned 202 with an empty body, so the
 * SDK could not tell an accepted batch from a silently dropped one — past the
 * quota they were byte-identical. The receipt now names what happened per
 * event, and a caller can be told.
 *
 * `Retry-After` is honoured, as it was in v1, and `keepalive` is set so a
 * flush survives the page that started it.
 */

import type { QueuedEvent } from "./queue";

export type SendOutcome =
  | { readonly kind: "accepted"; readonly receipt: IngestReceipt }
  /** Resending may work. `retryAfterMs` when the server said when. */
  | { readonly kind: "retry"; readonly status: number; readonly retryAfterMs: number | null; readonly detail: string }
  /** Resending cannot work. The batch is dropped and the developer told. */
  | { readonly kind: "refused"; readonly status: number; readonly detail: string };

export type IngestReceipt = {
  readonly accepted: number;
  readonly deduplicated: number;
  readonly rejected: number;
  readonly outcomes?: readonly { index: number; accepted: boolean; reason?: string }[];
  readonly quota?: { state: string; used: number; limit: number | null };
};

export type TransportOptions = {
  readonly endpoint: string;
  readonly key: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
};

const parseRetryAfter = (header: string | null): number | null => {
  if (header === null) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  // The header may also be an HTTP date.
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
};

/**
 * Statuses that are retryable when the server does not say.
 *
 * Only reached against a server too old to send a problem envelope, or a proxy
 * answering on its behalf. Anything not listed is treated as permanent, which
 * is the safe direction: a retry loop against a 400 is a busy loop.
 */
const RETRYABLE_STATUSES: readonly number[] = [408, 425, 429, 500, 502, 503, 504];

export const sendBatch = async (
  events: readonly QueuedEvent[],
  options: TransportOptions,
): Promise<SendOutcome> => {
  const http = options.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);

  try {
    const response = await http(options.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.key}` },
      body: JSON.stringify({ events }),
      // So a flush started as the page unloads is not cancelled with it.
      keepalive: true,
      signal: controller.signal,
    });

    if (response.ok) {
      const receipt = (await response.json().catch(() => null)) as IngestReceipt | null;
      return {
        kind: "accepted",
        receipt: receipt ?? { accepted: events.length, deduplicated: 0, rejected: 0 },
      };
    }

    const problem = (await response.json().catch(() => null)) as
      | { retryable?: boolean; detail?: string; code?: string }
      | null;
    const detail = problem?.detail ?? `HTTP ${response.status}`;

    // The server's own answer wins. Falling back to a status list only
    // matters against something that is not our API.
    const retryable = problem?.retryable ?? RETRYABLE_STATUSES.includes(response.status);
    if (!retryable) return { kind: "refused", status: response.status, detail };

    return {
      kind: "retry",
      status: response.status,
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
      detail,
    };
  } catch (error) {
    // A network error or an abort. Always retryable: nothing was heard back,
    // so nothing is known about whether it landed.
    return {
      kind: "retry",
      status: 0,
      retryAfterMs: null,
      detail: error instanceof Error ? error.message : "network error",
    };
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * A last-resort send as the page goes away.
 *
 * `sendBeacon` cannot set headers, which is why the ingest endpoint accepts a
 * public key as `?key=`. It also cannot report success, so this returns only
 * whether the browser accepted the beacon for delivery — not whether it
 * arrived. Used on `visibilitychange`, where the alternative is losing the
 * last events of a session entirely.
 */
export const sendBeacon = (events: readonly QueuedEvent[], options: TransportOptions): boolean => {
  const navigator = (globalThis as { navigator?: { sendBeacon?: (url: string, data: Blob) => boolean } }).navigator;
  if (typeof navigator?.sendBeacon !== "function") return false;

  const url = `${options.endpoint}${options.endpoint.includes("?") ? "&" : "?"}key=${encodeURIComponent(options.key)}`;
  const blob = new Blob([JSON.stringify({ events })], { type: "application/json" });
  try {
    return navigator.sendBeacon(url, blob);
  } catch {
    return false;
  }
};
