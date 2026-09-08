/**
 * ShareGrant — a short-lived capability to read ONE dashboard.
 *
 * A share token is a view of one page, not a guest account. v2 got the
 * evaluation right (`decide.ts:166-168` bound a token to a single dashboard)
 * but the grant value itself did not say which dashboard it was for, so the
 * binding lived in whichever caller remembered to check. Here the dashboard id
 * is part of the grant, the aggregate refuses a grant minted for anything else,
 * and `Dashboard.authorizeShareRead` re-checks it on every read. A grant that
 * ends up attached to a sibling dashboard — by a bad join, a copied row, a
 * repository that resolved a digest to the wrong aggregate — is refused rather
 * than honoured.
 *
 * Only the digest is stored. The token itself exists in the URL the customer
 * pasted and nowhere else, so a database read cannot hand anyone a working
 * link.
 */

import type { DashboardId, Instant } from "@counted/kernel";

export type ShareGrant = {
  /** The one dashboard this grant opens. Part of the value, not of the caller. */
  readonly dashboard: DashboardId;
  /** Digest of the share token. Never the token. */
  readonly digest: string;
  readonly expiresAt: Instant;
};

export const ShareGrant = {
  of: (dashboard: DashboardId, digest: string, expiresAt: Instant): ShareGrant => ({
    dashboard,
    digest,
    expiresAt,
  }),
} as const;
