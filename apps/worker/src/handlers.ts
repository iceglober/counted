/**
 * The registry of job handlers.
 *
 * Empty for now by design: the runtime lands first, and each job arrives with
 * its own issue and its own tests. A name with no handler here is simply never
 * enqueued — the scheduler skips it — so shipping the runtime alone does not
 * fill the queue with work nothing will claim.
 */

import type { JobName } from "@counted/ports";
import type { Handler } from "./runtime";

export const handlers: Readonly<Partial<Record<JobName, Handler>>> = {};
