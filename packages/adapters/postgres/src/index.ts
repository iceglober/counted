/**
 * @counted/adapter-postgres — repositories, the unit of work, and the outbox.
 *
 * Serves several contexts, which is why it is shared rather than owned by one.
 * One database, three schemas: `public` for the domain, `auth` for
 * better-auth, `events` for litics. A schema here is a namespace that stops
 * generated objects colliding with application tables — it is not isolation,
 * and everything stays transactional together.
 *
 * Nothing in this package decides anything. Every rule lives in a domain
 * package; this one turns aggregates into rows and back, and refuses rows it
 * cannot honestly turn into aggregates.
 */

export {
  applySchema,
  SCHEMA_STATEMENTS,
  DOMAIN_MIGRATIONS,
  DOMAIN_TABLES,
  type ApplySchemaOptions,
} from "./schema";

export {
  SCHEMA_LOCK_KEY,
  SCHEMA_LOCK_TIMEOUT_MS,
  SchemaLockTimeout,
  type SchemaLockOptions,
} from "./schema-lock";

export {
  applyMigrations,
  withSchemaLock,
  MigrationFailed,
  MIGRATION_LEDGER,
  type MigrationOutcome,
  type MigrationStep,
} from "./migrations";

export {
  RowDecodeError,
  unvalidatedAnalysisCodec,
  type AnalysisCodec,
  type Column,
} from "./decode";

export type { Queryable } from "./queryable";

export {
  noTenancyTree,
  type TenancyStatement,
  type TenancyTree,
} from "./tenancy-tree";

export {
  noMemberships,
  type AccountMembership,
  type WorkspaceMemberships,
} from "./memberships";

export { PostgresWorkspaceRepository, type WorkspaceRepositoryOptions } from "./workspace-repository";
export { PostgresSubscriptionRepository, PostgresWebhookLedger } from "./subscription-repository";
export { PostgresProjectRepository, projectCreatedAt } from "./project-repository";
export { PostgresDashboardRepository } from "./dashboard-repository";
export { PostgresMonitorRepository } from "./monitor-repository";
export { PostgresOutbox, DEFAULT_CLAIM_LEASE_SECONDS, type OutboxOptions } from "./outbox";

export {
  postgresUnitOfWork,
  postgresRepositories,
  pooledRepositories,
  type CountedRepositories,
  type PostgresAdapterOptions,
} from "./unit-of-work";
