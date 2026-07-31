/**
 * The control plane: everything that is not an event.
 *
 * Shaped around aggregates rather than around screens. A workspace's roster of
 * projects is derived from the projects table rather than duplicated, and a
 * dashboard's tiles are one JSONB document because a tile has no life outside
 * its dashboard — loading half a dashboard is not a thing anyone needs.
 *
 * Credentials, by contrast, are rows: they are queried by digest on the ingest
 * hot path, they are revoked individually, and there may be many per project.
 */

export const CREATE_CONTROL_PLANE = /* sql */ `
CREATE TABLE IF NOT EXISTS workspaces (
  id            uuid        PRIMARY KEY,
  name          text        NOT NULL,
  plan          text        NOT NULL DEFAULT 'free',
  payment_state text        NOT NULL DEFAULT 'none',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id   text        NOT NULL,
  role         text        NOT NULL,
  since        timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, account_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id                uuid        PRIMARY KEY,
  -- NULL while unclaimed. The claim grant is what lets it be adopted.
  workspace_id      uuid        REFERENCES workspaces(id) ON DELETE CASCADE,
  name              text        NOT NULL,
  state             text        NOT NULL DEFAULT 'active',
  claim_digest      text        UNIQUE,
  claim_expires_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_workspace_idx ON projects (workspace_id);

CREATE TABLE IF NOT EXISTS credentials (
  id          uuid        PRIMARY KEY,
  project_id  uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind        text        NOT NULL,
  label       text        NOT NULL,
  -- Only the hash is stored. The secret is shown once, at issue.
  digest      text        NOT NULL UNIQUE,
  prefix      text        NOT NULL,
  scopes      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  issued_at   timestamptz NOT NULL,
  expires_at  timestamptz,
  revoked_at  timestamptz
);
CREATE INDEX IF NOT EXISTS credentials_project_idx ON credentials (project_id);

CREATE TABLE IF NOT EXISTS dashboards (
  id                uuid        PRIMARY KEY,
  workspace_id      uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name              text        NOT NULL,
  is_default        boolean     NOT NULL DEFAULT false,
  share_digest      text        UNIQUE,
  share_expires_at  timestamptz,
  tiles             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dashboards_workspace_idx ON dashboards (workspace_id);

-- One default dashboard per workspace. v1 enforced one per *user* while its
-- loader resolved the default per *project*, so the two disagreed about what
-- "default" even meant.
CREATE UNIQUE INDEX IF NOT EXISTS dashboards_one_default_per_workspace
  ON dashboards (workspace_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS monitors (
  id               uuid        PRIMARY KEY,
  project_id       uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name             text        NOT NULL,
  analysis         jsonb       NOT NULL,
  threshold        jsonb       NOT NULL,
  cooldown_ms      bigint      NOT NULL,
  channels         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  enabled          boolean     NOT NULL DEFAULT true,
  state            text        NOT NULL DEFAULT 'ok',
  last_notified_at timestamptz,
  last_value       double precision
);
CREATE INDEX IF NOT EXISTS monitors_project_idx ON monitors (project_id);
CREATE INDEX IF NOT EXISTS monitors_enabled_idx ON monitors (enabled) WHERE enabled;
`;

export const CONTROL_PLANE_STATEMENTS: readonly string[] = [CREATE_CONTROL_PLANE];
