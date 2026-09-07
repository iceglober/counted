/**
 * The scalar vocabulary every wire schema is built from.
 *
 * Two conversions happen here and nowhere else, because v1 had them in eleven
 * places and disagreed with itself in three:
 *
 *   - a branded id is an opaque string on the wire. `WorkspaceId` and
 *     `ProjectId` are the same shape; the brand exists inside the process and
 *     is erased before it reaches HTTP. The named aliases below are for the
 *     reader, not the validator.
 *   - an `Instant` is an ISO-8601 UTC string, and a `Duration` is an integer
 *     count of milliseconds with an `Ms` suffix on the field name. Never a
 *     bare number called `timeout`, which v1 had meaning seconds in one place
 *     and milliseconds in another.
 */

import { ALL_PERMISSIONS, MAX_ID_LENGTH, ROLES } from "@counted/kernel";
import * as z from "zod";

/**
 * Every id the API accepts. `MAX_ID_LENGTH` comes from the kernel so a change
 * there cannot leave the wire accepting ids the domain will refuse.
 */
export const IdSchema = z.string().min(1).max(MAX_ID_LENGTH);

export const WorkspaceIdSchema = IdSchema.describe("Workspace id.");
export const ProjectIdSchema = IdSchema.describe("Project id.");
export const DashboardIdSchema = IdSchema.describe("Dashboard id.");
export const TileIdSchema = IdSchema.describe("Tile id.");
export const MonitorIdSchema = IdSchema.describe("Monitor id.");
export const AccountIdSchema = IdSchema.describe("Account id.");
export const CredentialIdSchema = IdSchema.describe("Credential id.");

/**
 * ISO-8601 in UTC, which is exactly what `Instant.toISO` produces and exactly
 * what `Instant.fromISO` accepts. Offsets are refused rather than normalised:
 * two spellings of one moment is how a range filter ends up off by an hour.
 */
export const InstantSchema = z.iso
  .datetime()
  .describe("An instant in time, ISO-8601 with a trailing Z.");

/** A length, in whole milliseconds. Field names carry the `Ms` suffix. */
export const DurationMsSchema = z
  .int()
  .nonnegative()
  .describe("A length of time in milliseconds.");

/**
 * The authorization vocabulary, derived from the kernel rather than retyped.
 *
 * If someone adds a fifteenth permission, every route that names permissions
 * accepts it on the next generation — there is no second list to forget.
 */
export const PermissionSchema = z.enum(ALL_PERMISSIONS).describe("A permission.");
export const RoleSchema = z.enum(ROLES).describe("A workspace role.");

/**
 * A GET route's query parameters arrive as strings. Coercion belongs on the
 * schema rather than in a handler, so the OpenAPI document and the running
 * server agree about what `?limit=50` means.
 *
 * The bounds are applied *after* coercion on the same schema rather than
 * through a `pipe`. A pipe's JSON Schema is the input half, so the document
 * would have advertised an unbounded integer while the server enforced a cap —
 * which is the kind of disagreement this package exists to prevent.
 */
export const queryInt = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max);
