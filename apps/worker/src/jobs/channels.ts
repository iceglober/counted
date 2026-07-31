/**
 * Where a monitor's notifications go.
 *
 * Read at dispatch rather than carried on the event. Both are defensible —
 * carrying them would freeze the target at the moment the alert fired — but
 * reading them means removing a channel takes effect on the events already
 * queued, which is the behaviour someone expects after deleting an address.
 */

import { MonitorId } from "@counted/domain";
import type { Channels } from "@counted/application";
import type { DomainEventEnvelope, UnitOfWork } from "@counted/ports";

export const monitorChannels =
  (unitOfWork: UnitOfWork) =>
  async (envelope: DomainEventEnvelope): Promise<Channels> => {
    const payload = envelope.payload;
    const id =
      typeof payload === "object" && payload !== null && typeof (payload as { monitor?: unknown }).monitor === "string"
        ? (payload as { monitor: string }).monitor
        : null;
    if (id === null) return [];

    const monitor = await unitOfWork.transact((repos) => repos.monitors.find(MonitorId(id)));
    // A monitor deleted between firing and dispatch has no channels, so its
    // event is marked and drained rather than retried against nothing.
    if (monitor === null) return [];

    return monitor.snapshot().channels.map((channel) =>
      channel.kind === "email"
        ? { kind: "email" as const, address: channel.address }
        : { kind: "webhook" as const, url: channel.url },
    );
  };
