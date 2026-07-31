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

-- One row per workspace, upserted. v1 updated a subscriptions row keyed on
-- user_id, which matched nothing for every first-time subscriber: the customer
-- paid, the statement reported success, and nothing changed.
CREATE TABLE IF NOT EXISTS subscriptions (
  workspace_id      uuid        PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  plan              text        NOT NULL DEFAULT 'free',
  payment_state     text        NOT NULL DEFAULT 'none',
  customer_ref      text        UNIQUE,
  subscription_ref  text        UNIQUE,
  renews_at         timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Stripe delivers at-least-once and retries for days. Without this, a retried
-- checkout event is applied twice — harmless for the transition itself, not
-- harmless for the message that goes out with it.
CREATE TABLE IF NOT EXISTS webhook_events (
  id           text        PRIMARY KEY,
  type         text        NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- Background work.
--
-- The unique index on (name, key) is the whole idempotency story at enqueue
-- time, and it is deliberately *not* partial. An earlier version excluded
-- completed jobs, which looked right and was not: a replica that enqueued,
-- claimed, ran and completed a job in one tick left nothing for the index to
-- conflict with, so the next replica enqueued the same job again and it ran
-- twice. The key already encodes the time bucket, so uniqueness over all time
-- is exactly the rule wanted — a given (name, bucket) runs once, ever.
--
-- Re-running is expressed by using a different key, and a retry reuses the
-- same row by moving run_after, so neither needs a second insert.
CREATE TABLE IF NOT EXISTS jobs (
  id           uuid        PRIMARY KEY,
  name         text        NOT NULL,
  key          text        NOT NULL,
  payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  run_after    timestamptz NOT NULL,
  claimed_at   timestamptz,
  claimed_by   text,
  attempts     integer     NOT NULL DEFAULT 0,
  last_error   text,
  completed_at timestamptz,
  outcome      text
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_per_key ON jobs (name, key);

-- The claim query's index. Partial, because completed jobs are the vast
-- majority of the table and none of them are ever claimed again.
CREATE INDEX IF NOT EXISTS jobs_claimable_idx
  ON jobs (run_after) WHERE completed_at IS NULL;

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

-- The console's own sign-in. Not the domain's: an account id is what the
-- domain sees, and everything below here is how a browser proves it holds one.
CREATE TABLE IF NOT EXISTS accounts (
  id         text        PRIMARY KEY,
  -- Lowercased before storage, so one person cannot end up with two accounts
  -- by capitalising their address differently.
  email      text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

-- A mailed sign-in link. Single use, short lived, and stored only as a digest
-- so a dump of this table cannot be used to sign in as anybody.
CREATE TABLE IF NOT EXISTS sign_in_tokens (
  digest     text        PRIMARY KEY,
  account_id text        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  -- Set when spent. A row is kept rather than deleted so that a replayed link
  -- is recognisably *used* rather than indistinguishable from a forged one.
  used_at    timestamptz
);
CREATE INDEX IF NOT EXISTS sign_in_tokens_expiry_idx ON sign_in_tokens (expires_at);

CREATE TABLE IF NOT EXISTS console_sessions (
  digest     text        PRIMARY KEY,
  account_id text        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS console_sessions_account_idx ON console_sessions (account_id);
CREATE INDEX IF NOT EXISTS console_sessions_expiry_idx ON console_sessions (expires_at);
`;

export const CONTROL_PLANE_STATEMENTS: readonly string[] = [CREATE_CONTROL_PLANE];
