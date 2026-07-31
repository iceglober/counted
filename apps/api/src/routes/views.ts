/**
 * Domain objects to wire shapes.
 *
 * Every management response is built here, and each function's return type is
 * the published schema's inferred type. That is the mechanism: the wire types
 * have no field a secret could occupy, so writing one would be a compile
 * error. v1 returned `SELECT *` from `GET /projects` — the whole row,
 * including `serverKey`, `apiKey` and `claimToken` — to any member of the
 * workspace, and nothing anywhere said it should not.
 *
 * `Credential` is the case to look at. The domain's credential carries a
 * digest; this one does not have the field. There is nowhere to put it.
 */

import {
  Credential,
  Instant,
  type Channel,
  type Dashboard,
  type Credential as DomainCredential,
  type Monitor,
  type Project,
  type Tile,
  type Workspace,
} from "@counted/domain";
import type { z } from "@counted/contracts";
import type {
  CredentialViewSchema,
  DashboardViewSchema,
  MonitorViewSchema,
  ProjectViewSchema,
  WorkspaceViewSchema,
} from "@counted/contracts";

type CredentialView = z.infer<typeof CredentialViewSchema>;
type ProjectView = z.infer<typeof ProjectViewSchema>;
type WorkspaceView = z.infer<typeof WorkspaceViewSchema>;
type DashboardView = z.infer<typeof DashboardViewSchema>;
type MonitorView = z.infer<typeof MonitorViewSchema>;

/**
 * Derived here rather than left to the client.
 *
 * "Expiring" is the rotation grace window — still working, on the way out.
 * Three states computed in one place beats every consumer reimplementing the
 * `revokedAt`/`expiresAt` rule and one of them getting it wrong.
 */
const statusOf = (credential: DomainCredential, at: Instant): CredentialView["status"] => {
  if (Credential.isRevoked(credential)) return "revoked";
  if (Credential.isExpiring(credential, at)) return "expiring";
  return Credential.isUsable(credential, at) ? "active" : "expired";
};

export const credentialView = (credential: DomainCredential, at: Instant): CredentialView => ({
  id: String(credential.id),
  kind: credential.kind,
  label: credential.label,
  // The display stub, not the digest. There is no digest field on this type.
  prefix: String(credential.prefix),
  scopes: [...credential.scopes],
  issuedAt: Instant.toISO(credential.issuedAt),
  expiresAt: credential.expiresAt === null ? null : Instant.toISO(credential.expiresAt),
  revokedAt: credential.revokedAt === null ? null : Instant.toISO(credential.revokedAt),
  status: statusOf(credential, at),
});

export const projectView = (project: Project, at: Instant): ProjectView => {
  const snapshot = project.snapshot();
  return {
    id: String(snapshot.id),
    name: snapshot.name,
    workspaceId: project.workspace === null ? null : String(project.workspace),
    state: snapshot.ownership.state,
    // Metadata only. A claim grant's digest is not here either — claiming is
    // its own endpoint, and a project list is not the place to discover how to
    // adopt someone else's project.
    credentials: snapshot.credentials.map((c) => credentialView(c, at)),
  };
};

export const workspaceView = (workspace: Workspace): WorkspaceView => {
  const snapshot = workspace.snapshot();
  return {
    id: String(snapshot.id),
    name: snapshot.name,
    members: snapshot.memberships.map((m) => ({
      accountId: String(m.account),
      role: m.role,
      since: Instant.toISO(m.since),
    })),
    projects: snapshot.projects.map((p) => ({ id: String(p.id), name: p.name, state: p.state })),
    limits: { maxProjects: snapshot.limits.maxProjects, maxSeats: snapshot.limits.maxSeats },
  };
};

const tileView = (tile: Tile): DashboardView["tiles"][number] => ({
  id: String(tile.id),
  title: tile.title,
  projectId: String(tile.project),
  width: tile.width,
  content: tile.content,
});

export const dashboardView = (dashboard: Dashboard): DashboardView => {
  const snapshot = dashboard.snapshot();
  return {
    id: String(snapshot.id),
    workspaceId: String(snapshot.workspace),
    name: snapshot.name,
    isDefault: snapshot.isDefault,
    tiles: snapshot.tiles.map(tileView),
    // Whether a link exists and when it lapses — never the token itself.
    // Anyone who can read the dashboard would otherwise be handed a URL that
    // works without logging in, which is how v1's share page worked.
    share: {
      active: snapshot.share !== null,
      expiresAt: snapshot.share === null ? null : Instant.toISO(snapshot.share.expiresAt),
    },
  };
};

/**
 * A channel with its secret removed.
 *
 * A webhook URL routinely carries a token in its path, and an email address is
 * personal data about a colleague. Neither belongs in a response that any
 * member can fetch, so the target is reduced to something recognisable.
 */
const channelView = (channel: Channel): MonitorView["channels"][number] => {
  if (channel.kind === "email") {
    const [local = "", domain = ""] = channel.address.split("@", 2);
    return { kind: "email", target: `${local.slice(0, 2)}…@${domain}` };
  }
  try {
    // Host only. The path is where a webhook token lives.
    return { kind: "webhook", target: new URL(channel.url).host };
  } catch {
    return { kind: "webhook", target: "webhook" };
  }
};

export const monitorView = (monitor: Monitor): MonitorView => {
  const snapshot = monitor.snapshot();
  return {
    id: String(snapshot.id),
    projectId: String(snapshot.project),
    name: snapshot.name,
    analysis: snapshot.analysis,
    threshold: snapshot.threshold,
    cooldownMs: Number(snapshot.cooldown),
    channels: snapshot.channels.map(channelView),
    enabled: snapshot.enabled,
    state: snapshot.state,
    lastNotifiedAt: snapshot.lastNotifiedAt === null ? null : Instant.toISO(snapshot.lastNotifiedAt),
    lastValue: snapshot.lastValue,
  };
};
