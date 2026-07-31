/**
 * Console sign-in, over Postgres.
 *
 * Three rules run through every query here, and each replaces something v1 got
 * wrong:
 *
 * 1. **Only digests are stored.** A sign-in link and a session cookie are
 *    bearer secrets; a dump of these tables must not let anyone sign in.
 * 2. **Answers do not depend on whether an address exists.** `beginSignIn`
 *    creates the account when it has not seen the address, so the caller can
 *    respond identically either way. A product that says "no account with that
 *    email" has published its user list.
 * 3. **A token is spent atomically.** Redemption is one `UPDATE … WHERE
 *    used_at IS NULL … RETURNING`, so two clicks on the same link — a mail
 *    client prefetching it, then the human — cannot both open a session.
 */

import { createHash, randomBytes } from "node:crypto";
import { AccountId, Instant } from "@counted/domain";
import {
  CONSOLE_SESSION_TTL_MS,
  SIGN_IN_TOKEN_TTL_MS,
  type Account,
  type ConsoleSessions,
  type Redemption,
} from "@counted/ports";
import type { Pool } from "pg";

/** Same construction as every other secret here: 256 bits, base64url. */
const mintSecret = (): string => randomBytes(32).toString("base64url");

export const digestOf = (secret: string): string => createHash("sha256").update(secret, "utf8").digest("hex");

/**
 * Addresses are compared lowercased and trimmed.
 *
 * Not full RFC normalisation — the local part is technically case-sensitive —
 * but no mail provider anyone uses honours that, and the alternative is one
 * person holding two accounts because they capitalised their address on a
 * phone.
 */
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const toAccount = (row: { id: string; email: string; created_at: Date }): Account => ({
  id: AccountId(row.id),
  email: row.email,
  createdAt: Instant.fromEpochMillis(row.created_at.getTime()),
});

export type ConsoleDeps = {
  /** Injected so account ids match every other id this system mints. */
  readonly newAccountId: () => string;
  /** Injected so a test can hold both secrets it is about to assert on. */
  readonly mint?: () => string;
};

export const createConsoleSessions = (pool: Pool, deps: ConsoleDeps): ConsoleSessions => {
  const mint = deps.mint ?? mintSecret;

  return {
    async beginSignIn(email, at) {
      const normalized = normalizeEmail(email);
      const now = new Date(Instant.toEpochMillis(at));
      const expiresAt = Instant.fromEpochMillis(Instant.toEpochMillis(at) + SIGN_IN_TOKEN_TTL_MS);

      // Upsert rather than select-then-insert: two sign-in requests racing for
      // a new address would otherwise both insert, and one would fail on the
      // unique index at exactly the moment somebody was trying to sign in.
      // The DO UPDATE is a no-op write whose only job is to make RETURNING
      // yield the existing row — `DO NOTHING` returns nothing at all.
      const { rows } = await pool.query<{ id: string; email: string; created_at: Date }>(
        `INSERT INTO accounts (id, email, created_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id, email, created_at`,
        [deps.newAccountId(), normalized, now],
      );
      const account = rows[0];
      if (account === undefined) throw new Error("accounts upsert returned no row");

      const token = mint();
      await pool.query(
        `INSERT INTO sign_in_tokens (digest, account_id, expires_at) VALUES ($1, $2, $3)`,
        [digestOf(token), account.id, new Date(Instant.toEpochMillis(expiresAt))],
      );

      return { token, expiresAt };
    },

    async redeem(token, at) {
      const now = new Date(Instant.toEpochMillis(at));
      const digest = digestOf(token);

      // One statement, so a mail client prefetching the link and the human
      // behind it cannot both succeed. `used_at IS NULL` in the WHERE is the
      // whole lock.
      const spent = await pool.query<{ account_id: string }>(
        `UPDATE sign_in_tokens
            SET used_at = $2
          WHERE digest = $1 AND used_at IS NULL AND expires_at > $2
        RETURNING account_id`,
        [digest, now],
      );

      const claimed = spent.rows[0];
      if (claimed === undefined) {
        // Told apart only for the log. The caller collapses them: a token that
        // never existed and one that timed out must look identical from
        // outside, or the difference is an oracle for guessing tokens.
        const { rows } = await pool.query(`SELECT 1 FROM sign_in_tokens WHERE digest = $1`, [digest]);
        return rows.length === 0 ? { kind: "unknown" } : { kind: "expired" };
      }

      const { rows } = await pool.query<{ id: string; email: string; created_at: Date }>(
        `SELECT id, email, created_at FROM accounts WHERE id = $1`,
        [claimed.account_id],
      );
      const account = rows[0];
      if (account === undefined) return { kind: "unknown" };

      const secret = mint();
      const expiresAt = Instant.fromEpochMillis(Instant.toEpochMillis(at) + CONSOLE_SESSION_TTL_MS);
      await pool.query(
        `INSERT INTO console_sessions (digest, account_id, created_at, expires_at) VALUES ($1, $2, $3, $4)`,
        [digestOf(secret), account.id, now, new Date(Instant.toEpochMillis(expiresAt))],
      );

      return { kind: "signed_in", account: toAccount(account), secret, expiresAt };
    },

    async accountFor(digest, at) {
      // The expiry is in the WHERE rather than checked after: a session that
      // expired between the read and the check would otherwise be honoured,
      // and that window is exactly as long as the round trip.
      const { rows } = await pool.query<{ id: string; email: string; created_at: Date }>(
        `SELECT a.id, a.email, a.created_at
           FROM console_sessions s
           JOIN accounts a ON a.id = s.account_id
          WHERE s.digest = $1 AND s.expires_at > $2`,
        [digest, new Date(Instant.toEpochMillis(at))],
      );
      const row = rows[0];
      return row === undefined ? null : toAccount(row);
    },

    async endSession(digest) {
      await pool.query(`DELETE FROM console_sessions WHERE digest = $1`, [digest]);
    },

    async purgeExpired(before) {
      const cutoff = new Date(Instant.toEpochMillis(before));
      const tokens = await pool.query(`DELETE FROM sign_in_tokens WHERE expires_at < $1`, [cutoff]);
      const sessions = await pool.query(`DELETE FROM console_sessions WHERE expires_at < $1`, [cutoff]);
      return { tokens: tokens.rowCount ?? 0, sessions: sessions.rowCount ?? 0 };
    },
  };
};
