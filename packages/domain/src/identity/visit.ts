/**
 * Visit — an activity grouping, and explicitly not an identity.
 *
 * A visit id is generated on the client, lives in memory, and rolls over after
 * 30 minutes of inactivity. It is not stored in a cookie, in localStorage, or
 * on disk. Close the tab and it is gone.
 *
 * The rollover rule lives here rather than only in the SDK because both the
 * client and any server-side reconstruction have to agree on it. In v1 the
 * 30-minute timeout was a constant in `packages/sdk/src/session.ts` and
 * nothing else knew about it — which is how retention ended up cohorting on
 * an id that expires four times an hour and reporting ~0 forever.
 */

import type { Brand } from "../shared/brand";
import { Duration } from "../shared/duration";
import { Instant } from "../shared/instant";

export type VisitId = Brand<string, "VisitId">;

/** Visit ids arrive from the client. They are opaque to us. */
export const VisitId = (raw: string): VisitId => raw as VisitId;

/** The idle gap after which a visit is considered finished. */
export const VISIT_IDLE_TIMEOUT = Duration.minutes(30);

export const MAX_VISIT_ID_LENGTH = 100;

export type Visit = {
  readonly id: VisitId;
  readonly startedAt: Instant;
  readonly lastSeenAt: Instant;
};

export const Visit = {
  begin: (id: VisitId, at: Instant): Visit => ({ id, startedAt: at, lastSeenAt: at }),

  touch: (v: Visit, at: Instant): Visit => ({ ...v, lastSeenAt: Instant.max(v.lastSeenAt, at) }),

  /**
   * Has this visit gone idle long enough to be over? The comparison is
   * strictly greater-than, so activity exactly on the boundary continues the
   * visit rather than starting a new one.
   */
  hasLapsed: (v: Visit, at: Instant, timeout: Duration = VISIT_IDLE_TIMEOUT): boolean =>
    Duration.toMillis(Instant.between(v.lastSeenAt, at)) > Duration.toMillis(timeout),

  duration: (v: Visit): Duration => Instant.between(v.startedAt, v.lastSeenAt),
} as const;
