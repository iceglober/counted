/**
 * Driving ports — what the outside world may ask the application to do.
 *
 * Every inbound adapter (the HTTP API, the worker's jobs, a future CLI) goes
 * through these. The web app is not on this list because it is an HTTP client
 * of the API, which is what "API-first" means structurally: if the UI can do
 * it, the public API can do it, because there is no other door.
 *
 * Each returns a `Result`, so a use case failing is a value the caller must
 * handle rather than an exception that becomes a 500.
 */

import type {
  AccountId,
  Analysis,
  Dashboard,
  DashboardId,
  Entitlement,
  Instant,
  PersonId,
  Project,
  ProjectId,
  QuotaDecision,
  Readout,
  Result,
  Role,
  TileId,
  VisitId,
  Workspace,
  WorkspaceId,
} from "@counted/domain";

/** Who is asking, and what they may do. Resolved by the API's auth layer. */
export type Principal =
  | { readonly kind: "account"; readonly account: AccountId }
  | { readonly kind: "credential"; readonly project: ProjectId; readonly scopes: readonly string[] }
  | { readonly kind: "share"; readonly dashboard: DashboardId };

export type UseCaseError = {
  readonly code: string;
  readonly detail: string;
  readonly status: "not_found" | "forbidden" | "invalid" | "conflict" | "unavailable";
};

// ── Ingestion ────────────────────────────────────────────────────────────────

export type IngestEvent = {
  readonly name: string;
  readonly visit: VisitId;
  readonly person: PersonId | null;
  readonly occurredAt: Instant | null;
  readonly idempotencyKey: string | null;
  readonly properties: Readonly<Record<string, string | number | boolean | null>>;
  readonly system: Readonly<Record<string, string | null>>;
};

/** Per-event outcome, so one bad event does not reject the whole batch. */
export type IngestOutcome =
  | { readonly index: number; readonly accepted: true; readonly deduplicated: boolean }
  | { readonly index: number; readonly accepted: false; readonly reason: string };

export type IngestReceipt = {
  readonly outcomes: readonly IngestOutcome[];
  readonly quota: QuotaDecision;
  readonly committedAt: Instant;
};

export interface IngestEvents {
  execute(
    project: ProjectId,
    events: readonly IngestEvent[],
  ): Promise<Result<IngestReceipt, UseCaseError>>;
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface RunAnalysis {
  execute(
    principal: Principal,
    project: ProjectId,
    analysis: Analysis,
  ): Promise<Result<Readout, UseCaseError>>;
}

export interface LoadDashboard {
  /** One call, one batch. Never an N+1 fan-out. */
  execute(
    principal: Principal,
    dashboard: DashboardId,
  ): Promise<Result<{ dashboard: Dashboard; readouts: readonly Readout[] }, UseCaseError>>;
}

// ── Management ───────────────────────────────────────────────────────────────

export interface CreateWorkspace {
  execute(founder: AccountId, name: string): Promise<Result<Workspace, UseCaseError>>;
}

export interface CreateProject {
  /** Returns the project and the one-time secret; the secret is never stored. */
  execute(
    principal: Principal,
    workspace: WorkspaceId,
    name: string,
  ): Promise<Result<{ project: Project; secret: string }, UseCaseError>>;
}

export interface ProvisionUnclaimedProject {
  /** The no-signup path: mints a project, a key, and a claim link. */
  execute(name: string): Promise<Result<{ project: Project; secret: string; claimToken: string }, UseCaseError>>;
}

export interface ClaimProject {
  execute(
    principal: Principal,
    claimToken: string,
    workspace: WorkspaceId,
  ): Promise<Result<Project, UseCaseError>>;
}

export interface InviteMember {
  execute(
    principal: Principal,
    workspace: WorkspaceId,
    account: AccountId,
    role: Role,
  ): Promise<Result<Workspace, UseCaseError>>;
}

export interface UpdateTile {
  execute(
    principal: Principal,
    dashboard: DashboardId,
    tile: TileId,
    change: { title?: string; analysis?: Analysis; width?: number },
  ): Promise<Result<Dashboard, UseCaseError>>;
}

export interface ReadEntitlement {
  execute(workspace: WorkspaceId): Promise<Result<Entitlement, UseCaseError>>;
}
