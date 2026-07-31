/**
 * Workspace failures. Every one is a rule someone can break, so they are
 * values returned in a Result — not exceptions, and not strings.
 *
 * The `kind` discriminant is what an API adapter maps to a problem+json code,
 * and what `assertNever` uses to make a new variant a compile error at every
 * place that handles them.
 */

import type { AccountId, ProjectId } from "../shared/ids";
import type { Role } from "./membership";

export type WorkspaceError =
  | { kind: "NameRequired" }
  | { kind: "AlreadyAMember"; account: AccountId }
  | { kind: "NotAMember"; account: AccountId }
  | { kind: "RoleUnchanged"; account: AccountId; role: Role }
  | { kind: "LastOwner"; account: AccountId }
  | { kind: "SeatLimitReached"; limit: number }
  | { kind: "ProjectExists"; project: ProjectId }
  | { kind: "NoSuchProject"; project: ProjectId }
  | { kind: "ProjectAlreadyArchived"; project: ProjectId }
  | { kind: "ProjectLimitReached"; limit: number };
