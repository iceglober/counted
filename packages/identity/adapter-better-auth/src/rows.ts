/**
 * The database rows this package reads, and the one place they are named.
 *
 * better-auth's adapter is generic — `findOne<T>` returns whatever `T` you ask
 * for and validates nothing — so the type parameter is an assertion, not a
 * check. Concentrating those assertions here means there is exactly one place
 * to look when a vendor column is renamed, instead of a cast at every call
 * site. Every field is optional-ish and every reader is defensive, because a
 * row is data from a database and not a value the type system produced.
 */

import { Instant, type Instant as InstantType } from "@counted/kernel";

/** better-auth's `user`. */
export type UserRow = {
  id: string;
  email: string;
  name?: string | null;
  emailVerified?: boolean | number | null;
  createdAt?: Date | string | number | null;
};

/** The organization plugin's `member`. */
export type MemberRow = {
  id: string;
  userId: string;
  organizationId: string;
  role?: string | null;
  createdAt?: Date | string | number | null;
};

/** The organization plugin's `organization`. */
export type OrganizationRow = {
  id: string;
  name?: string | null;
  slug?: string | null;
  createdAt?: Date | string | number | null;
};

/** The api-key plugin's `apikey`, plus the columns `placement.ts` adds. */
export type ApiKeyRow = {
  id: string;
  configId?: string | null;
  name?: string | null;
  start?: string | null;
  prefix?: string | null;
  key?: string | null;
  referenceId?: string | null;
  enabled?: boolean | number | null;
  permissions?: unknown;
  rateLimitEnabled?: boolean | number | null;
  rateLimitTimeWindow?: number | null;
  rateLimitMax?: number | null;
  /**
   * The vendor's own timestamps. Read by nothing in this package and listed
   * here so that "we leave these alone" is a statement the type system carries
   * rather than a claim in a comment. `expiresAt` in particular stays null on
   * every key we issue — see `placement.ts` for what fills it in otherwise.
   */
  createdAt?: Date | string | number | null;
  expiresAt?: Date | string | number | null;
  countedWorkspaceId?: string | null;
  countedProjectId?: string | null;
  countedIssuedById?: string | null;
  countedIssuedAt?: Date | string | number | null;
  countedExpiresAt?: Date | string | number | null;
  countedRevokedAt?: Date | string | number | null;
  countedLastUsedAt?: Date | string | number | null;
  countedWindowStartedAt?: Date | string | number | null;
  countedWindowCount?: number | null;
};

/**
 * A timestamp column as an Instant, or null.
 *
 * Three shapes because three adapters: `Date` from Kysely and the in-memory
 * store, an ISO string from a driver configured not to parse dates, and a
 * number from anything that stored epoch millis. An unparseable value reads as
 * null rather than as the epoch — a credential that appears to have been
 * created in 1970 is worse than one whose creation time is unknown.
 */
export const instantOf = (value: Date | string | number | null | undefined): InstantType | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? Instant.fromEpochMillis(millis) : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? Instant.fromEpochMillis(value) : null;
  }
  const parsed = Instant.fromISO(value);
  return parsed.ok ? parsed.value : null;
};

/** Writing one back. */
export const dateOf = (instant: InstantType): Date => Instant.toDate(instant);

/**
 * A boolean column. SQLite and some drivers hand booleans back as 0/1, and
 * `enabled` is load-bearing: reading `0` as truthy would make a revoked key
 * verify.
 */
export const booleanOf = (value: boolean | number | null | undefined, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return fallback;
};
