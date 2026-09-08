import { describe, expect, test } from "bun:test";

import { isErr, isOk } from "@counted/kernel";

import { admitOptionalPerson, admitPersonId, MAX_PERSON_ID_LENGTH } from "./person";

describe("admitPersonId", () => {
  test("an opaque customer identifier is accepted", () => {
    const result = admitPersonId("cus_9f2QhT");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toBe("cus_9f2QhT" as never);
  });

  test("surrounding whitespace is trimmed, because it is a copy-paste artefact and not an identity", () => {
    const result = admitPersonId("  cus_9f2  ");
    if (!isOk(result)) throw new Error("expected Ok");
    expect(result.value).toBe("cus_9f2" as never);
  });

  test("an email address is refused", () => {
    // The product's claim is that it stores no personal data. Accepting this
    // would make that false in the one column that is easiest to read.
    for (const raw of ["ada@example.com", "ada.lovelace+counted@sub.example.co.uk"]) {
      const result = admitPersonId(raw);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error).toEqual({ kind: "PersonIdLooksLikeEmail" });
    }
  });

  test("something merely containing an @ is not an email address", () => {
    // The check is loose on purpose, but not so loose it refuses `@ada`, which
    // is a perfectly ordinary handle.
    expect(isOk(admitPersonId("@ada"))).toBe(true);
    expect(isOk(admitPersonId("org@1"))).toBe(true);
  });

  test("an empty or whitespace-only value is a client bug, not an anonymous event", () => {
    // `identify(user.id)` where `user.id` was `""`. Silently treating it as
    // anonymous hides the bug and quietly loses the attribution.
    for (const raw of ["", "   "]) {
      const result = admitPersonId(raw);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error).toEqual({ kind: "PersonIdRequired" });
    }
  });

  test("a non-string is refused rather than coerced", () => {
    for (const raw of [42, true, {}, []]) {
      expect(isErr(admitPersonId(raw))).toBe(true);
    }
  });

  test("an over-long value is refused with both numbers, so the fix is obvious", () => {
    const raw = "x".repeat(MAX_PERSON_ID_LENGTH + 1);
    const result = admitPersonId(raw);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toEqual({
        kind: "PersonIdTooLong",
        length: MAX_PERSON_ID_LENGTH + 1,
        max: MAX_PERSON_ID_LENGTH,
      });
    }
  });

  test("exactly at the limit is accepted", () => {
    expect(isOk(admitPersonId("x".repeat(MAX_PERSON_ID_LENGTH)))).toBe(true);
  });
});

describe("admitOptionalPerson", () => {
  test("absence is a person of none, not a failure", () => {
    // Most events have no person. Refusing them would refuse every event from
    // every customer who never calls identify().
    for (const raw of [undefined, null]) {
      const result = admitOptionalPerson(raw);
      if (!isOk(result)) throw new Error("expected Ok");
      expect(result.value).toBeNull();
    }
  });

  test("a present value is held to every rule", () => {
    expect(isErr(admitOptionalPerson("ada@example.com"))).toBe(true);
    expect(isErr(admitOptionalPerson(""))).toBe(true);
  });
});
