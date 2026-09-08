import { Instant, unbrand } from "@counted/kernel";
import type { Channel, Monitor } from "./monitor";
import type { MonitorEvent } from "./events";
import type { Threshold } from "./threshold";

/** Immutable recipient and observation, captured when a transition commits. */
export type MonitorAlert = {
  readonly id: string;
  readonly monitor: string;
  readonly workspace: string;
  readonly project: string;
  readonly name: string;
  readonly channel: Channel;
  readonly state: "breaching" | "ok";
  readonly observed: number;
  readonly threshold: Threshold;
  readonly entering?: boolean;
  readonly occurredAt: string;
};

export const alertsFor = <A>(monitor: Monitor<A>, event: MonitorEvent): readonly MonitorAlert[] => {
  if (event.kind !== "MonitorFired" && event.kind !== "MonitorRecovered") return [];
  const eventId = `${unbrand(monitor.id)}:${event.kind}:${Instant.toEpochMillis(event.at)}`;
  const channels = [...new Map(monitor.channels.map((channel) => [JSON.stringify(channel), channel])).values()];
  return channels.map((channel, index) => ({
    id: `${eventId}:${index}`,
    monitor: unbrand(monitor.id), workspace: unbrand(monitor.workspace), project: unbrand(monitor.project),
    name: monitor.name, channel, state: event.kind === "MonitorFired" ? "breaching" : "ok",
    observed: event.observed, threshold: monitor.threshold,
    ...(event.kind === "MonitorFired" ? { entering: event.entering } : {}),
    occurredAt: Instant.toISO(event.at),
  }));
};
