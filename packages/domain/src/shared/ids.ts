/**
 * Identifiers.
 *
 * Every id is branded, so a ProjectId cannot be passed where a WorkspaceId is
 * expected. v1 passed bare uuid strings everywhere and at one point handed
 * `dashboard.projectId ?? ""` to a uuid parameter — an empty string that threw
 * in Postgres, got swallowed, and rendered as a blank chart.
 *
 * The domain never *generates* ids. It has no randomness (see the
 * `domain-has-no-io` rule), so ids arrive from the caller, minted by an adapter.
 */

import type { Brand } from "./brand";

export type WorkspaceId = Brand<string, "WorkspaceId">;
export type AccountId = Brand<string, "AccountId">;
export type ProjectId = Brand<string, "ProjectId">;
export type DashboardId = Brand<string, "DashboardId">;
export type CredentialId = Brand<string, "CredentialId">;

export const WorkspaceId = (raw: string): WorkspaceId => raw as WorkspaceId;
export const AccountId = (raw: string): AccountId => raw as AccountId;
export const ProjectId = (raw: string): ProjectId => raw as ProjectId;
export const DashboardId = (raw: string): DashboardId => raw as DashboardId;
export const CredentialId = (raw: string): CredentialId => raw as CredentialId;
