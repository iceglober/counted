import { describe, expect, test } from "bun:test";
import { CredentialId, Duration, Instant } from "@counted/kernel";
import {
  canIngest,
  credentialStatus,
  isUsable,
  mayRevoke,
  mayRotate,
  nameIsAvailable,
  usableIngestCredentials,
  type CredentialFacts,
} from "./credential";

const NOW = Instant.fromEpochMillis(1_700_000_000_000);
const HOUR = Duration.hours(1);

const key = (over: Omit<Partial<CredentialFacts>, "id"> & { id: string }): CredentialFacts => ({
  kind: "ingest",
  name: "production",
  expiresAt: null,
  revokedAt: null,
  ...over,
  id: CredentialId(over.id),
});

describe("credentialStatus — the single derivation", () => {
  test("a key with no expiry and no revocation is active", () => {
    expect(credentialStatus(key({ id: "a" }), NOW)).toBe("active");
  });

  test("a key mid-rotation is expiring, not active and not dead", () => {
    // This is the state the v2 console could not represent. It derived two
    // states from revokedAt alone, so a rotation in progress looked exactly
    // like a key nobody had touched — the rotation was invisible in the one
    // place a human would check it had happened.
    const rotating = key({ id: "a", expiresAt: Instant.plus(NOW, HOUR) });
    expect(credentialStatus(rotating, NOW)).toBe("expiring");
    expect(isUsable(rotating, NOW)).toBe(true);
  });

  test("an expiring key becomes expired once its window closes, with no write", () => {
    const rotating = key({ id: "a", expiresAt: Instant.plus(NOW, HOUR) });
    const after = Instant.plus(NOW, Duration.hours(2));
    expect(credentialStatus(rotating, after)).toBe("expired");
    expect(isUsable(rotating, after)).toBe(false);
  });

  test("the expiry instant itself is already past", () => {
    // Half-open, like every other range in the system: a key that expires at
    // T does not work at T. Anything else means two systems disagree about
    // one millisecond, forever.
    const edge = key({ id: "a", expiresAt: NOW });
    expect(credentialStatus(edge, NOW)).toBe("expired");
  });

  test("revocation outranks expiry", () => {
    // A key that was revoked and then aged out is still best described by the
    // deliberate act. The audit answer 'somebody killed this' is the useful one.
    const both = key({ id: "a", expiresAt: NOW, revokedAt: NOW });
    expect(credentialStatus(both, Instant.plus(NOW, HOUR))).toBe("revoked");
  });

  test("every other question about a key is derived from it", () => {
    // The point of exporting one function: usable, revocable and rotatable
    // cannot drift from the status a client renders, because they are computed
    // from it rather than beside it.
    const cases: readonly CredentialFacts[] = [
      key({ id: "a" }),
      key({ id: "b", expiresAt: Instant.plus(NOW, HOUR) }),
      key({ id: "c", expiresAt: Instant.minus(NOW, HOUR) }),
      key({ id: "d", revokedAt: NOW }),
    ];
    for (const c of cases) {
      const status = credentialStatus(c, NOW);
      expect(isUsable(c, NOW)).toBe(status === "active" || status === "expiring");
    }
  });
});

describe("mayRevoke — you may not revoke your last usable ingest key", () => {
  test("refuses the last one, as a value rather than an exception", () => {
    const only = key({ id: "a" });
    const refused = mayRevoke([only], only.id, NOW);
    expect(refused).toEqual({
      ok: false,
      error: { kind: "LastIngestCredential", credential: CredentialId("a") },
    });
  });

  test("allows it once a second usable ingest key exists", () => {
    const first = key({ id: "a" });
    const second = key({ id: "b", name: "next" });
    expect(mayRevoke([first, second], first.id, NOW).ok).toBe(true);
  });

  test("a key in its rotation grace window still counts as cover", () => {
    // Revoking the outgoing half of a rotation early must stay possible —
    // otherwise a leaked key cannot be killed until its overlap runs out,
    // which is precisely when you most want to kill it.
    const outgoing = key({ id: "a", expiresAt: Instant.plus(NOW, HOUR) });
    const replacement = key({ id: "b", name: "next" });
    expect(mayRevoke([outgoing, replacement], outgoing.id, NOW).ok).toBe(true);
    expect(mayRevoke([outgoing, replacement], replacement.id, NOW).ok).toBe(true);
  });

  test("a revoked or expired sibling is not cover", () => {
    const live = key({ id: "a" });
    const dead = key({ id: "b", name: "old", revokedAt: Instant.minus(NOW, HOUR) });
    const stale = key({ id: "c", name: "older", expiresAt: Instant.minus(NOW, HOUR) });
    const refused = mayRevoke([live, dead, stale], live.id, NOW);
    expect(refused.ok).toBe(false);
  });

  test("a service key is not cover for an ingest key, and is never the last one", () => {
    const ingest = key({ id: "a" });
    const service = key({ id: "b", kind: "service", name: "ci" });
    expect(mayRevoke([ingest, service], ingest.id, NOW).ok).toBe(false);
    // The rule protects ingest only: losing the last service key breaks a
    // deploy script, losing the last ingest key silently loses data.
    expect(mayRevoke([ingest, service], service.id, NOW).ok).toBe(true);
    expect(mayRevoke([service], service.id, NOW).ok).toBe(true);
  });

  test("names the specific failure for unknown, revoked and expired", () => {
    const revoked = key({ id: "a", revokedAt: NOW });
    const expired = key({ id: "b", expiresAt: Instant.minus(NOW, HOUR) });
    const pool = [revoked, expired];

    expect(mayRevoke(pool, CredentialId("zzz"), NOW)).toEqual({
      ok: false,
      error: { kind: "UnknownCredential", credential: CredentialId("zzz") },
    });
    expect(mayRevoke(pool, revoked.id, NOW)).toEqual({
      ok: false,
      error: { kind: "CredentialRevoked", credential: revoked.id },
    });
    expect(mayRevoke(pool, expired.id, NOW)).toEqual({
      ok: false,
      error: { kind: "CredentialExpired", credential: expired.id },
    });
  });
});

describe("mayRotate", () => {
  test("refuses a kind the caller did not expect", () => {
    // The console posts an id from two different panels to one route. Rotating
    // a service key from the ingest panel would hand the operator a secret for
    // something that was never an ingest key.
    const service = key({ id: "a", kind: "service", name: "ci" });
    expect(mayRotate([service], service.id, "ingest", NOW)).toEqual({
      ok: false,
      error: { kind: "RotationKindMismatch" },
    });
    expect(mayRotate([service], service.id, "service", NOW).ok).toBe(true);
    expect(mayRotate([service], service.id, null, NOW).ok).toBe(true);
  });

  test("a key already inside a grace window may be rotated again", () => {
    // Rotating twice in a day is what happens when the first replacement also
    // leaks. Refusing it would leave the operator with nothing to do.
    const outgoing = key({ id: "a", expiresAt: Instant.plus(NOW, HOUR) });
    expect(mayRotate([outgoing], outgoing.id, "ingest", NOW).ok).toBe(true);
  });

  test("a dead key is not rotated, it is replaced", () => {
    const revoked = key({ id: "a", revokedAt: NOW });
    expect(mayRotate([revoked], revoked.id, null, NOW).ok).toBe(false);
  });
});

describe("nameIsAvailable", () => {
  test("refuses a name a usable key already holds, and says which one", () => {
    const existing = key({ id: "a", name: "production" });
    expect(nameIsAvailable([existing], " production ", NOW)).toEqual({
      ok: false,
      error: { kind: "CredentialExists", credential: existing.id },
    });
  });

  test("a retired key does not reserve its name", () => {
    const retired = key({ id: "a", name: "production", revokedAt: NOW });
    expect(nameIsAvailable([retired], "production", NOW)).toEqual({
      ok: true,
      value: "production",
    });
  });

  test("an empty or whitespace name is refused before anything else", () => {
    expect(nameIsAvailable([], "   ", NOW)).toEqual({ ok: false, error: { kind: "NameRequired" } });
  });
});

describe("canIngest", () => {
  test("is true only while a usable ingest key exists", () => {
    const rotating = key({ id: "a", expiresAt: Instant.plus(NOW, HOUR) });
    expect(canIngest([rotating], NOW)).toBe(true);
    expect(canIngest([rotating], Instant.plus(NOW, Duration.hours(2)))).toBe(false);
    expect(canIngest([key({ id: "b", kind: "service", name: "ci" })], NOW)).toBe(false);
    expect(usableIngestCredentials([rotating], NOW)).toHaveLength(1);
  });
});
