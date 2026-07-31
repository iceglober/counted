/**
 * The registry of job handlers.
 *
 * A name with no handler here is never enqueued — the scheduler skips it — so
 * a job can land in its own issue without filling the queue with work nothing
 * will claim.
 */

import type { JobName, PartitionMaintenance, RetentionMaintenance, RollupMaintenance } from "@counted/ports";
import type { Handler } from "./runtime";
import { partitionsEnsure } from "./jobs/partitions-ensure";
import { retentionPurge } from "./jobs/retention-purge";
import { rollupsRefresh } from "./jobs/rollups-refresh";

export type JobDependencies = {
  readonly partitions: PartitionMaintenance;
  readonly retention: RetentionMaintenance;
  readonly rollups: RollupMaintenance;
};

export const buildHandlers = (deps: JobDependencies): Readonly<Partial<Record<JobName, Handler>>> => ({
  "partitions.ensure": partitionsEnsure(deps.partitions),
  "retention.purge": retentionPurge({ partitions: deps.partitions, retention: deps.retention }),
  "rollups.refresh": rollupsRefresh(deps.rollups),
});
