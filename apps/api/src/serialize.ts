/**
 * Aggregates and port values, as the contract's shapes.
 *
 * One direction only — outward. Everything here is total: no serializer can
 * fail, because a value that reached this layer has already been through a
 * domain that refuses the invalid ones. That is why there is no `Result` in
 * this file.
 *
 * Two things are computed here rather than stored, and both are deliberate.
 *
 * `Workspace.plan` and `Workspace.limits` describe the effective entitlement.
 * Historical paid standing remains on Subscription. The limits are not the
 * aggregate's `WorkspaceLimits` — the aggregate keeps the two numbers it
 * enforces, the wire wants all four a plan publishes. v2 rehydrated a workspace
 * with `WorkspaceLimits.UNLIMITED` hardcoded and a loaded workspace enforced no
 * cap at all; deriving both from `entitlement` on every read is what stops a
 * stored copy going stale.
 *
 * `effectiveRetentionDays` is the project's policy after the plan's ceiling.
 * The console needs the answer, not the two inputs, and computing it in the
 * client would put the clamp rule in two places.
 */

import { Duration, Instant, unbrand } from "@counted/kernel";
import { permissionsForRole } from "@counted/authorization";
import type { Account, CredentialSummary, Membership, VerifiedCredential } from "@counted/identity-ports";
import { credentialStatus, effectiveRetentionDays, type ProjectSnapshot } from "@counted/projects-domain";
import type { Dashboard, Monitor, Tile } from "@counted/dashboarding-domain";
import { Subscription as SubscriptionOps } from "@counted/tenancy-domain";
import type { Plan, Subscription, Workspace, WorkspaceUsage } from "@counted/tenancy-domain";
import type { HostedSession, WorkspaceSummary } from "@counted/tenancy-ports";
import type { ProjectSummary } from "@counted/projects-ports";
import type { DashboardSummary } from "@counted/dashboarding-ports";
import type { A } from "./deps";
import { fromAnalysis } from "./analysis/wire";

export const account = (value: Account): {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  createdAt: string;
} => ({
  id: unbrand(value.id),
  email: value.email,
  name: value.name,
  emailVerified: value.emailVerified,
  createdAt: Instant.toISO(value.createdAt),
});

export const member = (
  membership: Membership,
  person: Account,
): { account: ReturnType<typeof account>; role: Membership["role"]; since: string } => ({
  account: account(person),
  role: membership.role,
  since: Instant.toISO(membership.since),
});

export const workspace = (value: Workspace) => {
  const entitlement = value.entitlement;
  return {
    id: unbrand(value.id),
    name: value.name,
    plan: entitlement.plan,
    payment: value.payment,
    projectCount: value.projectCount,
    limits: {
      eventsPerMonth: entitlement.limits.eventsPerMonth,
      projects: entitlement.limits.projects,
      seats: entitlement.limits.seats,
      retentionDays: entitlement.limits.retentionDays,
    },
    inGrace: entitlement.inGrace,
  };
};

export const workspaceSummary = (value: WorkspaceSummary) => ({
  id: unbrand(value.id),
  name: value.name,
  role: value.role,
  permissions: [...permissionsForRole(value.role)],
});

export const plan = (value: Plan) => ({
  id: value.id,
  name: value.name,
  limits: {
    eventsPerMonth: value.limits.eventsPerMonth,
    projects: value.limits.projects,
    seats: value.limits.seats,
    retentionDays: value.limits.retentionDays,
  },
});

/**
 * The provider's ids are deliberately absent. They are of no use to a client
 * and of some use to anyone who should not have them; `hasBillingAccount` is
 * the only fact the console asks — whether "manage billing" can be shown.
 */
export const subscription = (value: Subscription) => ({
  workspace: unbrand(value.workspace),
  plan: value.plan,
  payment: value.payment,
  renewsAt: value.renewsAt === null ? null : Instant.toISO(value.renewsAt),
  updatedAt: Instant.toISO(value.updatedAt),
  hasBillingAccount: SubscriptionOps.hasBillingAccount(value),
});

export const hostedSession = (value: HostedSession) => ({
  url: value.url,
  expiresAt: value.expiresAt === null ? null : Instant.toISO(value.expiresAt),
});

export const usage = (value: WorkspaceUsage) => ({
  plan: value.plan,
  inGrace: value.inGrace,
  events: { used: value.events.used, limit: value.events.limit, state: value.events.state },
  projects: { used: value.projects.used, limit: value.projects.limit },
  seats: { used: value.seats.used, limit: value.seats.limit },
});

export const project = (snapshot: ProjectSnapshot, planRetentionDays: number | null) => ({
  id: unbrand(snapshot.id),
  name: snapshot.name,
  workspace:
    snapshot.ownership.state === "claimed" ? unbrand(snapshot.ownership.workspace) : null,
  archived: snapshot.archived,
  retention: snapshot.retention,
  effectiveRetentionDays: effectiveRetentionDays(snapshot.retention, planRetentionDays),
  claimedAt:
    snapshot.ownership.state === "claimed" ? Instant.toISO(snapshot.ownership.claimedAt) : null,
});

export const projectSummary = (value: ProjectSummary) => ({
  id: unbrand(value.id),
  workspace: value.workspace === null ? null : unbrand(value.workspace),
  name: value.name,
  archived: value.archived,
});

/**
 * A credential, with its status attached and its secret absent.
 *
 * The status is derived here rather than left to the caller: v2's console
 * re-derived a two-state version from `revokedAt`, so a key mid-rotation
 * rendered as though nothing had happened. A client handed `status` has no
 * reason to compute one.
 */
export const credential = (value: CredentialSummary, at: Instant) => ({
  id: unbrand(value.id),
  kind: value.kind,
  name: value.name,
  hint: value.hint,
  workspace: unbrand(value.workspace),
  project: value.project === null ? null : unbrand(value.project),
  permissions: [...value.permissions],
  issuedBy: unbrand(value.issuedBy),
  status: credentialStatus(value, at),
  createdAt: Instant.toISO(value.createdAt),
  expiresAt: value.expiresAt === null ? null : Instant.toISO(value.expiresAt),
  lastUsedAt: value.lastUsedAt === null ? null : Instant.toISO(value.lastUsedAt),
  revokedAt: value.revokedAt === null ? null : Instant.toISO(value.revokedAt),
});

export const issuedCredential = (
  value: { credential: CredentialSummary; secret: string },
  at: Instant,
) => ({ credential: credential(value.credential, at), secret: value.secret });

export const credentialIdentity = (value: VerifiedCredential) => ({
  id: unbrand(value.id),
  kind: value.kind,
  workspace: unbrand(value.workspace),
  project: value.project === null ? null : unbrand(value.project),
  permissions: [...value.permissions],
  issuedBy: unbrand(value.issuedBy),
});

export const tile = (value: Tile<A>) => ({
  id: unbrand(value.id),
  title: value.title,
  project: unbrand(value.project),
  analysis: fromAnalysis(value.analysis),
  view: value.view,
  width: value.width,
  layout: value.layout ?? null,
});

/**
 * A dashboard's share state is its expiry and nothing else. The token exists
 * once, at creation, and is never recoverable — which is why revoking and
 * re-sharing is the only way to get a URL back.
 */
export const dashboard = (value: Dashboard<A>) => ({
  id: unbrand(value.id),
  workspace: unbrand(value.workspace),
  name: value.name,
  tiles: value.tiles.map(tile),
  isDefault: value.isDefault,
  share: value.share === null ? null : { expiresAt: Instant.toISO(value.share.expiresAt) },
});

export const dashboardSummary = (value: DashboardSummary) => ({
  id: unbrand(value.id),
  workspace: unbrand(value.workspace),
  name: value.name,
  tileCount: value.tileCount,
  shared: value.shared,
  isDefault: value.isDefault,
});

export const monitor = (value: Monitor<A>) => ({
  id: unbrand(value.id),
  workspace: unbrand(value.workspace),
  project: unbrand(value.project),
  name: value.name,
  analysis: fromAnalysis(value.analysis),
  threshold: value.threshold,
  cooldownMs: Duration.toMillis(value.cooldown),
  channels: [...value.channels],
  enabled: value.enabled,
  state: value.state,
  lastNotifiedAt: value.lastNotifiedAt === null ? null : Instant.toISO(value.lastNotifiedAt),
  lastValue: value.lastValue,
  lastAttemptAt: value.lastAttemptAt === null ? null : Instant.toISO(value.lastAttemptAt),
  lastMeasuredAt: value.lastMeasuredAt === null ? null : Instant.toISO(value.lastMeasuredAt),
  evaluationError: value.evaluationError,
  pendingDeliveries: value.pendingDeliveries,
  failedDeliveries: value.failedDeliveries,
  deliveryError: value.deliveryError,
  lastDeliveredAt: value.lastDeliveredAt === null ? null : Instant.toISO(value.lastDeliveredAt),
});
