import type { ProjectId } from "../shared/ids";
import type { Instant } from "../shared/instant";
import type { MonitorId, Threshold } from "./monitor";

export type MonitorEvent =
  | { kind: "MonitorCreated"; monitor: MonitorId; project: ProjectId; name: string; at: Instant }
  | { kind: "MonitorFired"; monitor: MonitorId; project: ProjectId; observed: number; threshold: Threshold; entering: boolean; at: Instant }
  | { kind: "MonitorRecovered"; monitor: MonitorId; project: ProjectId; observed: number; at: Instant }
  | { kind: "MonitorEnabled"; monitor: MonitorId; at: Instant }
  | { kind: "MonitorDisabled"; monitor: MonitorId; at: Instant }
  | { kind: "MonitorRetargeted"; monitor: MonitorId; at: Instant };
