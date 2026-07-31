/**
 * Which domain events become which notifications.
 *
 * Pure. An envelope plus the channels its subject is configured with becomes a
 * list of notifications, and nothing here sends anything — so every routing
 * rule, every subject line and every "this event notifies nobody" decision is
 * testable without a mail server.
 *
 * The routing is deliberately narrow. An event that nobody has asked to be
 * told about produces no notification and is dispatched anyway, so the outbox
 * drains rather than accumulating events that will never be delivered. v1 had
 * no outbox at all: an alert either sent its email inline or lost it.
 */

import { Instant } from "@counted/domain";
import type { DomainEventEnvelope, Notification } from "@counted/ports";

/** Where a subject's notifications go. Empty means "tell nobody". */
export type Channels = readonly {
  readonly kind: "email" | "webhook";
  readonly address?: string;
  readonly url?: string;
}[];

/**
 * Looks up the channels for whatever an event concerns.
 *
 * A function rather than a map because the caller decides how to resolve it —
 * batched, cached, or one query at a time — and this file should not know.
 */
export type ChannelResolver = (event: DomainEventEnvelope) => Channels;

type MonitorPayload = {
  monitor?: string;
  project?: string;
  observed?: number;
  threshold?: { comparison?: string; value?: number };
  entering?: boolean;
};

const asPayload = (raw: unknown): MonitorPayload =>
  typeof raw === "object" && raw !== null ? (raw as MonitorPayload) : {};

const describeThreshold = (payload: MonitorPayload): string => {
  const comparison = payload.threshold?.comparison === "below" ? "below" : "above";
  const value = payload.threshold?.value;
  return value === undefined ? comparison : `${comparison} ${value}`;
};

/**
 * The message body.
 *
 * Plain text, and short. A notification that needs scrolling is a notification
 * whose first line failed to say what happened.
 */
const monitorFiredBody = (envelope: DomainEventEnvelope, payload: MonitorPayload): string =>
  [
    `A monitor is breaching.`,
    ``,
    `Observed: ${payload.observed ?? "unknown"}`,
    `Threshold: ${describeThreshold(payload)}`,
    `At: ${Instant.toISO(envelope.occurredAt)}`,
    ``,
    payload.entering === true
      ? `This is the first breach since it was last within threshold.`
      : `It has been breaching since before this notification; the cooldown has elapsed.`,
  ].join("\n");

const monitorRecoveredBody = (envelope: DomainEventEnvelope, payload: MonitorPayload): string =>
  [
    `A monitor is back within its threshold.`,
    ``,
    `Observed: ${payload.observed ?? "unknown"}`,
    `At: ${Instant.toISO(envelope.occurredAt)}`,
  ].join("\n");

/**
 * Turn one event into the notifications it warrants.
 *
 * Returns an empty list for events nobody subscribes to — most of them. The
 * outbox carries every domain event because that is what makes it useful for
 * audit and for future subscribers; only a few of them are worth waking
 * somebody for.
 */
export const routeEvent = (envelope: DomainEventEnvelope, resolve: ChannelResolver): readonly Notification[] => {
  if (envelope.type !== "MonitorFired" && envelope.type !== "MonitorRecovered") return [];

  const payload = asPayload(envelope.payload);
  const channels = resolve(envelope);
  if (channels.length === 0) return [];

  const fired = envelope.type === "MonitorFired";
  const subject = fired ? `Counted: a monitor is breaching` : `Counted: a monitor has recovered`;
  const body = fired ? monitorFiredBody(envelope, payload) : monitorRecoveredBody(envelope, payload);

  const notifications: Notification[] = [];
  for (const channel of channels) {
    if (channel.kind === "email" && channel.address !== undefined) {
      notifications.push({ channel: "email", to: channel.address, subject, body });
      continue;
    }
    if (channel.kind === "webhook" && channel.url !== undefined) {
      notifications.push({
        channel: "webhook",
        url: channel.url,
        // The outbox row's id. Stable across redeliveries, so a receiver can
        // drop the second copy.
        id: envelope.id,
        // The whole envelope, not a summary. A receiver that wants to build
        // its own logic should not have to ask us for numbers we already had.
        payload: {
          id: envelope.id,
          type: envelope.type,
          occurredAt: Instant.toISO(envelope.occurredAt),
          data: envelope.payload,
        },
      });
    }
  }
  return notifications;
};

/** Which event types produce notifications at all. For the dispatch log. */
export const NOTIFYING_TYPES: readonly string[] = ["MonitorFired", "MonitorRecovered"];
