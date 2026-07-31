import { describe, expect, test } from "bun:test";
import { Duration, Instant } from "../shared";
import { MAX_PERSON_ID_LENGTH, identify, personIdValue } from "./person";
import { VISIT_IDLE_TIMEOUT, Visit, VisitId } from "./visit";
import { CountingBasis, Subject } from "./subject";

const t0 = Instant.fromEpochMillis(1_700_000_000_000);
const at = (d: Duration) => Instant.plus(t0, d);

describe("identify is the only door to a PersonId", () => {
  test("it accepts an opaque customer identifier", () => {
    const r = identify("usr_8f3a91");
    expect(r.ok).toBe(true);
    if (r.ok) expect(personIdValue(r.value)).toBe("usr_8f3a91");
  });

  test("it trims", () => {
    const r = identify("  usr_1  ");
    if (!r.ok) throw new Error("expected ok");
    expect(personIdValue(r.value)).toBe("usr_1");
  });

  test("blank is refused", () => {
    expect(identify("")).toEqual({ ok: false, error: { kind: "PersonIdRequired" } });
    expect(identify("   ")).toEqual({ ok: false, error: { kind: "PersonIdRequired" } });
  });

  test("absurd lengths are refused", () => {
    const long = "u".repeat(MAX_PERSON_ID_LENGTH + 1);
    const r = identify(long);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ kind: "PersonIdTooLong", max: MAX_PERSON_ID_LENGTH });
  });

  test("exactly at the limit is fine", () => {
    expect(identify("u".repeat(MAX_PERSON_ID_LENGTH)).ok).toBe(true);
  });

  test("an email address is refused — passing one would put PII in a system that promises none", () => {
    for (const email of ["ada@example.com", "  ada.lovelace@sub.example.co.uk  "]) {
      const r = identify(email);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("PersonIdLooksLikeEmail");
    }
  });

  test("identifiers that merely contain an @ are still fine", () => {
    // A handle or a namespaced id is not an email address.
    expect(identify("@ada").ok).toBe(true);
    expect(identify("org@1234").ok).toBe(true);
  });
});

describe("Visit", () => {
  test("the idle timeout is 30 minutes and lives in the domain, not only in the SDK", () => {
    expect(Duration.toMillis(VISIT_IDLE_TIMEOUT)).toBe(30 * 60 * 1000);
  });

  test("activity inside the window continues the visit", () => {
    const v = Visit.begin(VisitId("1720656000.k3j9x2mp"), t0);
    const touched = Visit.touch(v, at(Duration.minutes(20)));
    expect(Visit.hasLapsed(touched, at(Duration.minutes(45)))).toBe(false);
  });

  test("a gap longer than the timeout ends it", () => {
    const v = Visit.begin(VisitId("v1"), t0);
    expect(Visit.hasLapsed(v, at(Duration.minutes(31)))).toBe(true);
  });

  test("exactly on the boundary continues rather than rolls over", () => {
    const v = Visit.begin(VisitId("v1"), t0);
    expect(Visit.hasLapsed(v, at(Duration.minutes(30)))).toBe(false);
  });

  test("touch never moves lastSeen backwards", () => {
    const v = Visit.touch(Visit.begin(VisitId("v1"), t0), at(Duration.minutes(10)));
    const outOfOrder = Visit.touch(v, at(Duration.minutes(5)));
    expect(outOfOrder.lastSeenAt).toBe(at(Duration.minutes(10)));
  });

  test("duration spans first to last activity", () => {
    const v = Visit.touch(Visit.begin(VisitId("v1"), t0), at(Duration.minutes(12)));
    expect(Duration.toMillis(Visit.duration(v))).toBe(720_000);
  });
});

describe("Subject", () => {
  const visit = VisitId("v1");
  const person = (() => {
    const r = identify("usr_1");
    if (!r.ok) throw new Error("unreachable");
    return r.value;
  })();

  test("an anonymous subject has a visit and no person", () => {
    const s = Subject.anonymous(visit);
    expect(Subject.visitOf(s)).toBe(visit);
    expect(Subject.personOf(s)).toBeNull();
    expect(Subject.isIdentified(s)).toBe(false);
  });

  test("an identified subject keeps its visit too", () => {
    const s = Subject.identified(visit, person);
    expect(Subject.visitOf(s)).toBe(visit);
    expect(Subject.personOf(s)).toBe(person);
    expect(Subject.isIdentified(s)).toBe(true);
  });
});

describe("CountingBasis", () => {
  test("only the person basis spans visits", () => {
    expect(CountingBasis.spansVisits("person")).toBe(true);
    expect(CountingBasis.spansVisits("visit")).toBe(false);
  });

  test("labels read as what they count", () => {
    expect(CountingBasis.label("visit")).toBe("visits");
    expect(CountingBasis.label("person")).toBe("people");
  });
});

describe("the privacy invariant", () => {
  test("a VisitId cannot stand in for a PersonId", () => {
    // The following does not compile, which is the entire point of #21:
    //
    //   const s = Subject.identified(VisitId("v1"), VisitId("v1"));
    //                                               ^^^^^^^^^^^^^
    //   Argument of type 'VisitId' is not assignable to parameter of type 'PersonId'.
    //
    // v1 had one `string` standing for a login session, an ephemeral visit and
    // a Stripe idempotency key, and the checker was happy to swap them.
    const r = identify("usr_1");
    if (!r.ok) throw new Error("unreachable");
    expect(Subject.personOf(Subject.identified(VisitId("v1"), r.value))).toBe(r.value);
  });
});
