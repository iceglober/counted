/**
 * Wrapping domain events for the outbox.
 *
 * The envelope carries what dispatch needs and the aggregate does not: a
 * delivery id stable across redeliveries (it travels as `webhook-id`, so a
 * receiver can deduplicate) and a fully qualified type string. The `projects.`
 * prefix is not decoration — a subscriber filtering on `NameChanged` with no
 * context would match three different contexts' events.
 */

import type { EventEnvelope } from "@counted/kernel";
import type { IdGenerator } from "@counted/kernel/ports";
import type { ProjectEvent } from "@counted/projects-domain";

export const envelopes = (
  events: readonly ProjectEvent[],
  ids: IdGenerator,
): readonly EventEnvelope<ProjectEvent>[] =>
  events.map((event) => ({
    id: ids.next(),
    type: `projects.${event.kind}`,
    occurredAt: event.at,
    payload: event,
  }));
