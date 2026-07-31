/**
 * What an adapter must provide for the contract suites to run against it.
 *
 * Deliberately small. If satisfying this is hard, the adapter is doing too
 * much — which is itself useful signal.
 */

import type { Instant, PersonId, ProjectId, VisitId } from "@counted/domain";
import type { AnalyticalStore } from "../driven/analytical-store";
import type { EventWriter, UsageMeter, WritableEvent } from "../driven/event-writer";
import type { UnitOfWork } from "../driven/unit-of-work";

export type StoreFixture = {
  readonly store: AnalyticalStore;
  readonly writer: EventWriter;
  /** A project that exists and is empty at the start of each case. */
  readonly project: ProjectId;
  /** Remove all events for the fixture project. Called before every case. */
  reset(): Promise<void>;
};

export type PersistenceFixture = {
  readonly unitOfWork: UnitOfWork;
  reset(): Promise<void>;
};

export type MeterFixture = {
  readonly meter: UsageMeter;
  readonly writer: EventWriter;
  readonly project: ProjectId;
  readonly workspace: import("@counted/domain").WorkspaceId;
  reset(): Promise<void>;
};

/** Convenience for building events in the suites without repeating boilerplate. */
export const anEvent = (
  project: ProjectId,
  name: string,
  occurredAt: Instant,
  overrides: Partial<WritableEvent> = {},
): WritableEvent => ({
  project,
  name,
  occurredAt,
  visit: "v-default" as VisitId,
  person: null as PersonId | null,
  idempotencyKey: `${name}-${String(occurredAt)}-${Math.trunc(Number(occurredAt))}`,
  properties: {},
  system: {},
  ...overrides,
});
