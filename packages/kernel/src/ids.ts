/**
 * Identifiers.
 *
 * Every id is branded, so a ProjectId cannot be passed where a WorkspaceId is
 * expected. v1 passed bare uuid strings everywhere and at one point handed
 * `dashboard.projectId ?? ""` to a uuid parameter — an empty string that threw
 * in Postgres, got swallowed, and rendered as a blank chart.
 *
 * The domain never *generates* ids. It has no randomness (see `domain-is-pure`
 * in .dependency-cruiser.cjs), so ids arrive from the caller, minted by an
 * adapter through the `IdGenerator` port.
 *
 * **What the guards do and do not tell you.** A brand is erased at runtime, so
 * `isProjectId` cannot distinguish a project id from a workspace id — nothing
 * can, they are both opaque strings. Every guard here asks the one question
 * that *is* answerable: is this value a usable identifier at all — a string,
 * non-empty, no surrounding or embedded whitespace, within length. Use them
 * where untrusted input becomes an id; do not use them to decide which kind of
 * id you are holding.
 */

import type { Brand } from "./brand";

/** Long enough for a uuid, a ULID, or a better-auth id; short enough to index. */
export const MAX_ID_LENGTH = 128;

const isIdShape = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_ID_LENGTH &&
  !/\s/.test(value);

/** A workspace: the tenancy root that owns the subscription and the limits. */
export type WorkspaceId = Brand<string, "WorkspaceId">;
export const WorkspaceId = (raw: string): WorkspaceId => raw as WorkspaceId;
export const isWorkspaceId = (v: unknown): v is WorkspaceId => isIdShape(v);

/** A project: one stream of events inside a workspace. */
export type ProjectId = Brand<string, "ProjectId">;
export const ProjectId = (raw: string): ProjectId => raw as ProjectId;
export const isProjectId = (v: unknown): v is ProjectId => isIdShape(v);

export type DashboardId = Brand<string, "DashboardId">;
export const DashboardId = (raw: string): DashboardId => raw as DashboardId;
export const isDashboardId = (v: unknown): v is DashboardId => isIdShape(v);

/** A tile: one question placed on one dashboard. */
export type TileId = Brand<string, "TileId">;
export const TileId = (raw: string): TileId => raw as TileId;
export const isTileId = (v: unknown): v is TileId => isIdShape(v);

export type MonitorId = Brand<string, "MonitorId">;
export const MonitorId = (raw: string): MonitorId => raw as MonitorId;
export const isMonitorId = (v: unknown): v is MonitorId => isIdShape(v);

/**
 * An account: a human who signs in. Under v3 this is better-auth's `user.id`,
 * accepted as given — the domain is Conformist to Identity and does not mint
 * its own.
 */
export type AccountId = Brand<string, "AccountId">;
export const AccountId = (raw: string): AccountId => raw as AccountId;
export const isAccountId = (v: unknown): v is AccountId => isIdShape(v);

/**
 * A credential: an ingest key, a service key, or a share grant. Under v3 the
 * row belongs to better-auth's api-key plugin; the id is still ours to pass
 * around, because every rule about credentials stays in the domain (§4).
 */
export type CredentialId = Brand<string, "CredentialId">;
export const CredentialId = (raw: string): CredentialId => raw as CredentialId;
export const isCredentialId = (v: unknown): v is CredentialId => isIdShape(v);

/**
 * A visit: an activity grouping that expires after 30 minutes idle. Generated
 * on the client, held in memory, never stored on the device. Explicitly not an
 * identity — that separation is the privacy claim, and the brand is what stops
 * a visit id drifting into a field that means a person.
 */
export type VisitId = Brand<string, "VisitId">;
export const VisitId = (raw: string): VisitId => raw as VisitId;
export const isVisitId = (v: unknown): v is VisitId => isIdShape(v);

/**
 * A person: a durable identifier the customer supplies. The guard here is the
 * shape check only; the rules that make an identifier acceptable — not an
 * email address, within the domain's own length limit — live in the ingestion
 * domain, because they are policy rather than syntax.
 */
export type PersonId = Brand<string, "PersonId">;
export const PersonId = (raw: string): PersonId => raw as PersonId;
export const isPersonId = (v: unknown): v is PersonId => isIdShape(v);
