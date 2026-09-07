/**
 * The one place this codebase throws instead of returning a `Result`.
 *
 * `Notifier.deliver` returns `Promise<void>`, so a failure has nowhere to go
 * but a throw — and that is the right shape here rather than an oversight in
 * the port. Delivery is driven by the outbox, and the outbox already has a
 * retry loop that keys off a rejected promise (`Outbox.recordFailure`). A
 * `Result` would mean every caller remembering to inspect it, and the caller
 * that forgot would silently drop mail.
 *
 * `retryable` is the part worth carrying. A 5xx or a socket reset means try
 * again; a 422 for a malformed recipient means this notification will fail
 * identically forever, and retrying it for three days is how a dead-letter
 * queue fills up with things that were never going to work.
 */

export type NotificationChannel = "email" | "webhook";

export class NotificationDeliveryError extends Error {
  readonly kind = "DeliveryFailed" as const;
  readonly channel: NotificationChannel;
  /** The provider's HTTP status, when there was a response at all. */
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    channel: NotificationChannel,
    message: string,
    options: { status?: number | null; retryable: boolean; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "NotificationDeliveryError";
    this.channel = channel;
    this.status = options.status ?? null;
    this.retryable = options.retryable;
  }
}

export const isNotificationDeliveryError = (
  value: unknown,
): value is NotificationDeliveryError =>
  value instanceof NotificationDeliveryError ||
  (typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "DeliveryFailed");

/**
 * Whether a status is worth trying again.
 *
 * 408, 425 and 429 are the 4xx exceptions: all three say "not now" rather than
 * "not ever". Everything else in the 4xx range is a statement about the
 * request, and the request will be byte-identical next time.
 */
export const isRetryableStatus = (status: number): boolean =>
  status >= 500 || status === 408 || status === 425 || status === 429;
