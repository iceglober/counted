/**
 * The columns better-auth's `apikey` table does not have, and the rules about
 * why we add them rather than reuse the vendor's.
 *
 * `@better-auth/api-key` models a key as belonging to one entity (a user or an
 * organization) with an expiry and an enabled flag. The domain needs more: a
 * key is *placed* on a workspace or on a project inside it, it carries the
 * authority of the account that issued it, and it can be revoked at a named
 * instant without disappearing from the record. None of that fits in
 * `referenceId`.
 *
 * better-auth merges plugin schemas by model name and spreads their fields
 * (`buildAuthTables` in @better-auth/core), so a plugin of our own that
 * declares `apikey` adds columns to the vendor's table instead of shadowing
 * it. Every added column is prefixed `counted` so that a future vendor field
 * can never collide with one of ours, and so that reading a row makes it
 * obvious which half of it belongs to whom.
 *
 * Two of these columns look redundant next to a vendor column and are not:
 *
 * - **`countedIssuedAt` / `countedExpiresAt` versus `createdAt` / `expiresAt`.**
 *   The port takes the instant as a parameter — `issue(request, at)` — because
 *   the caller has already read a clock, and two reads inside one operation is
 *   how a key gets an expiry earlier than its creation. The vendor stamps
 *   `new Date()`. Ours are the domain's instants and the vendor's are its own
 *   bookkeeping.
 *
 *   Leaving the vendor's `expiresAt` null is also what keeps expired keys in
 *   the record: `createApiKey` fires `deleteAllExpiredApiKeys`, which
 *   hard-deletes every row whose `expiresAt` is in the past. A key that lapsed
 *   would be erased, and "which key was this and who issued it" is a question
 *   asked after the key is already gone.
 *
 * - **`countedRevokedAt` versus `enabled`.** `enabled` is a boolean, and the
 *   port needs the instant. We write both: the instant for us, the flag so the
 *   vendor's own code paths also refuse the key.
 */

import type { CredentialKind } from "@counted/identity-ports";

/** The vendor's table, under the name its own code uses. */
export const API_KEY_MODEL = "apikey";
export const USER_MODEL = "user";
export const ORGANIZATION_MODEL = "organization";
export const MEMBER_MODEL = "member";

/**
 * One `configId` per credential kind, so the two are separable by a single
 * indexed column and a leaked `ck_` key cannot be mistaken for an `sk_` one at
 * lookup time.
 */
export const CONFIG_ID = {
  ingest: "ingest",
  service: "service",
} as const satisfies Record<CredentialKind, string>;

export const kindOfConfigId = (configId: string | null | undefined): CredentialKind | null => {
  if (configId === CONFIG_ID.ingest) return "ingest";
  if (configId === CONFIG_ID.service) return "service";
  return null;
};

/**
 * The columns we add to `apikey`.
 *
 * All optional at the schema level, deliberately. The vendor inserts the row
 * and we fill these in immediately afterwards, so a NOT NULL constraint would
 * reject the vendor's own insert. The invariant "a Counted credential has a
 * workspace" is therefore enforced in code rather than by the column: a row
 * with no `countedWorkspaceId` is not a credential this store issued, and
 * `verify` and `list` both refuse to see it. `issue` deletes the row it just
 * created if it cannot finish placing it, so the window in which such a row
 * exists is one failed statement wide.
 */
export const placementFields = {
  countedWorkspaceId: { type: "string", required: false, input: false, index: true },
  countedProjectId: { type: "string", required: false, input: false, index: true },
  countedIssuedById: { type: "string", required: false, input: false },
  countedIssuedAt: { type: "date", required: false, input: false },
  countedExpiresAt: { type: "date", required: false, input: false },
  countedRevokedAt: { type: "date", required: false, input: false },
  countedLastUsedAt: { type: "date", required: false, input: false },
  /** Start of the rate-limit window this key is currently inside. */
  countedWindowStartedAt: { type: "date", required: false, input: false },
  /** Requests counted inside that window. */
  countedWindowCount: { type: "number", required: false, input: false, defaultValue: 0 },
} as const;

/**
 * A plugin whose entire job is those columns.
 *
 * It registers no endpoints and no hooks. Shipping it as a plugin rather than
 * as a migration is what makes better-auth's own schema generator and its
 * adapters aware of the columns — which is the difference between a column the
 * ORM can select and one that only exists in a SQL file somebody has to
 * remember to run.
 */
export const countedPlacement = () =>
  ({
    id: "counted-placement",
    schema: { [API_KEY_MODEL]: { fields: placementFields } },
  }) as const;
