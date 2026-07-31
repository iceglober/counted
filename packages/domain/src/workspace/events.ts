/**
 * Domain events emitted by the Workspace aggregate.
 *
 * These are facts, past tense. The worker consumes them through the outbox
 * (#57) — LimitsChanged and the two Over*Limit events are what drive downgrade
 * handling without an aggregate deciding to delete a customer's data.
 */

import type { AccountId, ProjectId, WorkspaceId } from "../shared/ids";
import type { Instant } from "../shared/instant";
import type { Role } from "./membership";
import type { WorkspaceLimits } from "./workspace";

export type WorkspaceEvent =
  | { kind: "WorkspaceOpened"; workspace: WorkspaceId; founder: AccountId; at: Instant }
  | { kind: "WorkspaceRenamed"; workspace: WorkspaceId; name: string; at: Instant }
  | { kind: "MemberAdmitted"; workspace: WorkspaceId; account: AccountId; role: Role; at: Instant }
  | { kind: "RoleChanged"; workspace: WorkspaceId; account: AccountId; from: Role; to: Role; at: Instant }
  | { kind: "MemberRemoved"; workspace: WorkspaceId; account: AccountId; at: Instant }
  | { kind: "ProjectProvisioned"; workspace: WorkspaceId; project: ProjectId; name: string; at: Instant }
  | { kind: "ProjectArchived"; workspace: WorkspaceId; project: ProjectId; at: Instant }
  | { kind: "LimitsChanged"; workspace: WorkspaceId; limits: WorkspaceLimits; at: Instant }
  | { kind: "OverProjectLimit"; workspace: WorkspaceId; active: number; limit: number; at: Instant }
  | { kind: "OverSeatLimit"; workspace: WorkspaceId; seats: number; limit: number; at: Instant };
