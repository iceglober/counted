/**
 * Console sign-in, against a real PostgreSQL.
 *
 * The properties worth testing here are all ones a stub would grant for free:
 * that a link can be spent exactly once even under a race, that an expired
 * session stops working at the instant it expires rather than at the next
 * read, and that nothing about the answer depends on whether an address is
 * already known. Each is a query detail, and each is a real vulnerability if
 * the query is wrong.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Instant } from "@counted/domain";
import { CONSOLE_SESSION_TTL_MS, SIGN_IN_TOKEN_TTL_MS, type ConsoleSessions } from "@counted/ports";
import { createDatabase, type LiveDatabase } from "./testing/database";
import { SCHEMA_STATEMENTS } from "./sql/schema";
import { CONTROL_PLANE_STATEMENTS } from "./sql/control-plane";
import { createConsoleSessions, digestOf } from "./console";

const DB = "counted_v2_console";

const t0 = Instant.fromEpochMillis(Date.parse("2026-03-01T12:00:00Z"));
const plus = (ms: number): Instant => Instant.fromEpochMillis(Instant.toEpochMillis(t0) + ms);

let db: LiveDatabase;
let console_: ConsoleSessions;
let ids = 0;

beforeAll(async () => {
  db = await createDatabase(DB);
  for (const statement of [...SCHEMA_STATEMENTS, ...CONTROL_PLANE_STATEMENTS]) await db.pool.query(statement);
  console_ = createConsoleSessions(db.pool, { newAccountId: () => `acct_${++ids}` });
});

afterAll(async () => {
  await db?.pool.end();
  await db?.drop();
});

describe("a sign-in link", () => {
  test("an unknown address is signed up rather than refused", async () => {
    const { token } = await console_.beginSignIn("new@example.com", t0);
    const redeemed = await console_.redeem(token, plus(1_000));

    expect(redeemed.kind).toBe("signed_in");
    if (redeemed.kind !== "signed_in") return;
    expect(redeemed.account.email).toBe("new@example.com");
  });

  test("a known address signs in to the same account", async () => {
    // Sign-up and sign-in are one flow. If they were two, the product would
    // have to say which one applied — and that sentence is a published user
    // list.
    const first = await console_.beginSignIn("repeat@example.com", t0);
    const a = await console_.redeem(first.token, plus(1_000));
    const second = await console_.beginSignIn("repeat@example.com", plus(2_000));
    const b = await console_.redeem(second.token, plus(3_000));

    if (a.kind !== "signed_in" || b.kind !== "signed_in") throw new Error("expected both to sign in");
    expect(b.account.id).toBe(a.account.id);
  });

  test("the address is normalised, so one person is one account", async () => {
    const a = await console_.redeem((await console_.beginSignIn("Case@Example.com ", t0)).token, plus(1));
    const b = await console_.redeem((await console_.beginSignIn("case@example.com", plus(2))).token, plus(3));
    if (a.kind !== "signed_in" || b.kind !== "signed_in") throw new Error("expected both to sign in");
    expect(b.account.id).toBe(a.account.id);
  });

  test("only its digest is stored", async () => {
    // A dump of this table must not let anyone sign in.
    const { token } = await console_.beginSignIn("digest@example.com", t0);
    const { rows } = await db.pool.query<{ digest: string }>(`SELECT digest FROM sign_in_tokens`);
    expect(rows.map((r) => r.digest)).toContain(digestOf(token));
    expect(rows.map((r) => r.digest)).not.toContain(token);
  });
});

describe("a link is spent exactly once", () => {
  test("the second redemption fails", async () => {
    const { token } = await console_.beginSignIn("once@example.com", t0);
    const first = await console_.redeem(token, plus(1_000));
    const second = await console_.redeem(token, plus(2_000));

    expect(first.kind).toBe("signed_in");
    // Reported as expired, not unknown: the row exists and was used. The
    // caller shows one message for both, but the log can tell them apart.
    expect(second.kind).toBe("expired");
  });

  test("two simultaneous redemptions produce one session", async () => {
    // The real case, and the reason redemption is a single UPDATE: mail
    // clients prefetch links. If both won, the prefetch would burn the link
    // and the human would be told it was already used.
    const { token } = await console_.beginSignIn("race@example.com", t0);
    const results = await Promise.all([
      console_.redeem(token, plus(1_000)),
      console_.redeem(token, plus(1_000)),
      console_.redeem(token, plus(1_000)),
    ]);

    expect(results.filter((r) => r.kind === "signed_in")).toHaveLength(1);
    const { rows } = await db.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM console_sessions s
         JOIN accounts a ON a.id = s.account_id WHERE a.email = $1`,
      ["race@example.com"],
    );
    expect(rows[0]?.n).toBe("1");
  });

  test("an expired link cannot be redeemed", async () => {
    const { token } = await console_.beginSignIn("stale@example.com", t0);
    const redeemed = await console_.redeem(token, plus(SIGN_IN_TOKEN_TTL_MS + 1));
    expect(redeemed.kind).toBe("expired");
  });

  test("a link that never existed is refused the same way", async () => {
    const redeemed = await console_.redeem("not-a-real-token", plus(1_000));
    expect(redeemed.kind).toBe("unknown");
  });
});

describe("a session", () => {
  const sessionFor = async (email: string, at = t0) => {
    const { token } = await console_.beginSignIn(email, at);
    const redeemed = await console_.redeem(token, at);
    if (redeemed.kind !== "signed_in") throw new Error("expected a session");
    return redeemed;
  };

  test("resolves to its account while live", async () => {
    const { secret, account } = await sessionFor("live@example.com");
    const resolved = await console_.accountFor(digestOf(secret), plus(1_000));
    expect(resolved?.id).toBe(account.id);
  });

  test("stops resolving the moment it expires", async () => {
    // The expiry is in the WHERE clause rather than checked afterwards, so
    // there is no window in which an expired session is still honoured.
    const { secret } = await sessionFor("expiring@example.com");
    expect(await console_.accountFor(digestOf(secret), plus(CONSOLE_SESSION_TTL_MS - 1))).not.toBeNull();
    expect(await console_.accountFor(digestOf(secret), plus(CONSOLE_SESSION_TTL_MS + 1))).toBeNull();
  });

  test("only its digest is stored", async () => {
    const { secret } = await sessionFor("secret@example.com");
    const { rows } = await db.pool.query<{ digest: string }>(`SELECT digest FROM console_sessions`);
    expect(rows.map((r) => r.digest)).not.toContain(secret);
  });

  test("signing out ends it, and ending it twice is not an error", async () => {
    const { secret } = await sessionFor("out@example.com");
    await console_.endSession(digestOf(secret));
    expect(await console_.accountFor(digestOf(secret), plus(1_000))).toBeNull();
    await console_.endSession(digestOf(secret));
  });

  test("signing out ends one session, not every session that account has", async () => {
    // Signing out of a laptop must not sign out the phone.
    const laptop = await sessionFor("two@example.com", t0);
    const phone = await sessionFor("two@example.com", plus(1_000));

    await console_.endSession(digestOf(laptop.secret));
    expect(await console_.accountFor(digestOf(laptop.secret), plus(2_000))).toBeNull();
    expect(await console_.accountFor(digestOf(phone.secret), plus(2_000))).not.toBeNull();
  });

  test("an unknown digest resolves to nobody rather than throwing", async () => {
    expect(await console_.accountFor("0".repeat(64), t0)).toBeNull();
  });
});

describe("purging", () => {
  test("removes what has expired and leaves what has not", async () => {
    const fresh = await console_.beginSignIn("keep@example.com", t0);
    const redeemed = await console_.redeem(fresh.token, t0);
    if (redeemed.kind !== "signed_in") throw new Error("expected a session");
    await console_.beginSignIn("drop@example.com", t0);

    // Past every token's expiry but inside every session's.
    const purged = await console_.purgeExpired(plus(SIGN_IN_TOKEN_TTL_MS + 1));

    expect(purged.tokens).toBeGreaterThan(0);
    expect(purged.sessions).toBe(0);
    expect(await console_.accountFor(digestOf(redeemed.secret), plus(SIGN_IN_TOKEN_TTL_MS + 2))).not.toBeNull();
  });
});
