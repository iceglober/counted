import { describe, expect, test } from "bun:test";
import {
  Duration,
  Instant,
  Project,
  ProjectId,
  WorkspaceId,
  CredentialId,
} from "@counted/domain";
import { SECRET_PREFIXES, digestOf, displayPrefix, issueSecret, kindOf, secretGenerator } from "./secrets";
import { idGenerator, issueGrantToken, uuidv7 } from "./ids";

describe("secrets are shown once and stored as digests", () => {
  test("issuing returns the secret, a digest and a display stub", () => {
    const issued = issueSecret("ingest");
    expect(issued.secret.startsWith("ck_")).toBe(true);
    expect(issued.digest).toHaveLength(64); // sha256 hex
    expect(issued.prefix.startsWith("ck_")).toBe(true);
  });

  test("the digest does not contain the secret", () => {
    // A database dump must not hand anyone working keys. v1 stored them in
    // plaintext across three columns and compared by equality.
    const { secret, digest } = issueSecret("service");
    expect(digest).not.toContain(secret);
    expect(digest).not.toContain(secret.slice(4, 20));
  });

  test("the display prefix is enough to tell keys apart and useless for guessing", () => {
    const a = issueSecret("ingest");
    const b = issueSecret("ingest");
    expect(a.prefix).not.toBe(b.prefix);
    // Always the full six characters, whatever the body happens to contain.
    expect(a.prefix.length).toBe("ck_".length + 6);
    expect(b.prefix.length).toBe("ck_".length + 6);
    // Six characters of the random part; the other ~220 bits stay secret.
    expect(a.prefix.length).toBeLessThan(a.secret.length / 2);
    expect(a.secret.startsWith(a.prefix)).toBe(true);
  });

  test("hashing is deterministic, or verification could never work", () => {
    const { secret, digest } = issueSecret("service");
    expect(digestOf(secret)).toBe(digest);
    expect(digestOf(secret)).toBe(digestOf(secret));
  });

  test("a different secret gives a different digest", () => {
    expect(digestOf("ck_aaa")).not.toBe(digestOf("ck_aab"));
  });

  test("secrets do not repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, () => issueSecret("ingest").secret));
    expect(seen.size).toBe(500);
  });

  test("there is real entropy behind them", () => {
    // 32 bytes base64url ≈ 43 characters. A short or padded secret would mean
    // the generator was silently truncating.
    // Split at the first underscore only — base64url contains `_`, so
    // `split("_")[1]` truncates the body and this assertion would fail on
    // about half of all generated keys.
    const secret = issueSecret("ingest").secret;
    const body = secret.slice(secret.indexOf("_") + 1);
    expect(body.length).toBeGreaterThanOrEqual(42);
    expect(body).not.toContain("=");
    expect(body).not.toContain("+");
    expect(body).not.toContain("/");
  });
});

describe("the base64url alphabet contains the delimiter", () => {
  test("a body containing underscores does not shorten the display prefix", () => {
    // Constructed rather than sampled, so this holds every run instead of
    // ninety-one percent of them.
    expect(String(displayPrefix("ck_ab_cd_ef_gh"))).toBe("ck_ab_cd_"); // six body chars: a b _ c d _
    expect(kindOf("ck_ab_cd_ef")).toBe("ingest");
  });

  test("across many real keys, every prefix is full length", () => {
    for (let i = 0; i < 500; i++) {
      const issued = issueSecret("service");
      expect(issued.prefix.length).toBe(9);
      expect(issued.secret.startsWith(issued.prefix)).toBe(true);
    }
  });
});

describe("kinds are visible in the secret itself", () => {
  test("ingest and service are unmistakable", () => {
    expect(SECRET_PREFIXES.ingest).toBe("ck");
    expect(SECRET_PREFIXES.service).toBe("sk");
    expect(kindOf(issueSecret("ingest").secret)).toBe("ingest");
    expect(kindOf(issueSecret("service").secret)).toBe("service");
  });

  test("an unrecognised prefix is not silently treated as anything", () => {
    // v1 routed any non-ck_ key to a legacy column, which is how a key that
    // could never work was still accepted for lookup.
    expect(kindOf("xx_whatever")).toBeNull();
    expect(kindOf("no-underscore")).toBeNull();
  });

  test("the prefix is a claim, not proof — scopes decide what a key may do", () => {
    // Reading the prefix lets an obvious category error be rejected before
    // touching the database, but authority comes from the stored scopes.
    const service = issueSecret("service");
    expect(kindOf(service.secret)).toBe("service");
    expect(displayPrefix(service.secret).startsWith("sk_")).toBe(true);
  });
});

describe("it satisfies the SecretGenerator port", () => {
  test("issue and digest round-trip through the port shape", () => {
    const issued = secretGenerator.issue("ck");
    expect(secretGenerator.digest(issued.secret)).toBe(issued.digest);
  });

  test("verification works from the presented string alone", () => {
    // digest() takes no kind on purpose: a caller could otherwise be tricked
    // into hashing under the wrong assumption.
    const issued = secretGenerator.issue("sk");
    expect(secretGenerator.digest(issued.secret)).toBe(digestOf(issued.secret));
  });
});

describe("identifiers sort by creation time", () => {
  test("they are valid v7 uuids", () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("ids minted later sort after ids minted earlier", async () => {
    // Random keys scatter inserts across the whole btree; time-ordered ones
    // append. On a table taking events continuously that is the difference
    // between a healthy index and a fragmented one.
    const first = uuidv7();
    await Bun.sleep(2);
    const second = uuidv7();
    expect(second > first).toBe(true);
  });

  test("ids minted in the same millisecond are still distinct", () => {
    const batch = new Set(Array.from({ length: 1_000 }, () => idGenerator.next()));
    expect(batch.size).toBe(1_000);
  });
});

describe("grant tokens", () => {
  test("they are longer than a credential, because they travel in URLs", () => {
    // A URL may be logged, pasted or shoulder-surfed, and a grant cannot be
    // scoped down the way a credential can.
    const token = issueGrantToken();
    expect(token.length).toBeGreaterThanOrEqual(42);
    expect(new Set(Array.from({ length: 200 }, issueGrantToken)).size).toBe(200);
  });
});

describe("the whole credential lifecycle, end to end", () => {
  const t0 = Instant.fromEpochMillis(1_700_000_000_000);
  const prj = ProjectId("prj_1");
  const ws = WorkspaceId("ws_1");

  const must = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
    if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
    return r.value;
  };

  const request = (id: string, kind: "ingest" | "service", scopes?: readonly string[]) => {
    const issued = issueSecret(kind);
    return {
      issued,
      request: {
        id: CredentialId(id),
        kind,
        label: `${kind} key`,
        digest: issued.digest,
        prefix: issued.prefix,
        ...(scopes === undefined ? {} : { scopes: scopes as never }),
      },
    };
  };

  test("a real secret authenticates against the project that holds its digest", () => {
    const first = request("cred_1", "ingest");
    const project = must(Project.create(prj, "Web", ws, first.request, t0)).project;

    // What the adapter does at request time: hash what was presented, then ask
    // the aggregate.
    const presented = digestOf(first.issued.secret);
    expect(must(project.authenticate(presented, t0)).id).toBe(CredentialId("cred_1"));
  });

  test("a secret the project has never seen does not", () => {
    const first = request("cred_1", "ingest");
    const project = must(Project.create(prj, "Web", ws, first.request, t0)).project;
    const stranger = issueSecret("ingest");
    expect(project.authenticate(digestOf(stranger.secret), t0).ok).toBe(false);
  });

  test("rotation issues a new secret while the old one still works, then stops", () => {
    const first = request("cred_1", "ingest");
    const project = must(Project.create(prj, "Web", ws, first.request, t0)).project;
    const replacement = request("cred_2", "ingest");

    const rotated = must(project.rotate(CredentialId("cred_1"), replacement.request, Duration.hours(24), t0)).project;

    // Both work during the overlap — v1 overwrote in place and broke every
    // deployed client the instant someone clicked the button.
    expect(rotated.authenticate(digestOf(first.issued.secret), t0).ok).toBe(true);
    expect(rotated.authenticate(digestOf(replacement.issued.secret), t0).ok).toBe(true);

    const after = Instant.plus(t0, Duration.hours(25));
    expect(rotated.authenticate(digestOf(first.issued.secret), after).ok).toBe(false);
    expect(rotated.authenticate(digestOf(replacement.issued.secret), after).ok).toBe(true);
  });

  test("revocation is immediate, and the last ingest key cannot be revoked", () => {
    const first = request("cred_1", "ingest");
    const project = must(Project.create(prj, "Web", ws, first.request, t0)).project;

    expect(project.revoke(CredentialId("cred_1"), t0).ok).toBe(false);

    const second = request("cred_2", "ingest");
    const two = must(project.issue(second.request, t0)).project;
    const revoked = must(two.revoke(CredentialId("cred_1"), t0)).project;

    expect(revoked.authenticate(digestOf(first.issued.secret), t0).ok).toBe(false);
    expect(revoked.authenticate(digestOf(second.issued.secret), t0).ok).toBe(true);
  });

  test("an ingest secret carries events:write and nothing else, whatever was asked for", () => {
    const sneaky = request("cred_1", "ingest", ["projects:write", "dashboards:write"]);
    const { credential } = must(Project.create(prj, "Web", ws, sneaky.request, t0));
    expect(credential.scopes).toEqual(["events:write"]);
  });
});
