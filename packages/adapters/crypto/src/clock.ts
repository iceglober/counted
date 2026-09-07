/**
 * The one implementation that reads a machine clock.
 *
 * `@counted/kernel/ports` declares `Clock` and ships `fixedClock` and
 * `scriptedClock` — both of which are for tests, because the kernel has no
 * dependencies and no capabilities. Something has to actually call `Date.now`,
 * and it lands here for the same reason `randomBytes` does: this package is
 * where the machine gets to be consulted. Composition roots take it from here
 * and hand it down; nothing below `app` ever sees it.
 */

import { Instant } from "@counted/kernel";
import type { Clock } from "@counted/kernel/ports";

export const systemClock: Clock = {
  now: () => Instant.fromEpochMillis(Date.now()),
};
