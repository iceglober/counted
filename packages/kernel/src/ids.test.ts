import { describe, expect, test } from "bun:test";
import { assertNever, unbrand } from "./brand";
import {
  MAX_ID_LENGTH,
  PersonId,
  ProjectId,
  WorkspaceId,
  isAccountId,
  isPersonId,
  isProjectId,
  isVisitId,
  isWorkspaceId,
} from "./ids";

describe("the guards answer 'is this a usable identifier', nothing more", () => {
  test.each(["w_01HZ", "550e8400-e29b-41d4-a716-446655440000", "a"])(
    "%p is accepted",
    (raw) => {
      expect(isWorkspaceId(raw)).toBe(true);
    },
  );

  test.each([
    ["", "empty"],
    ["  ", "whitespace only"],
    ["has space", "embedded space"],
    ["trailing ", "trailing space"],
    ["line\nbreak", "newline"],
  ])("%p is rejected (%s)", (raw) => {
    expect(isWorkspaceId(raw)).toBe(false);
  });

  test("over the length limit is rejected", () => {
    expect(isWorkspaceId("x".repeat(MAX_ID_LENGTH))).toBe(true);
    expect(isWorkspaceId("x".repeat(MAX_ID_LENGTH + 1))).toBe(false);
  });

  test.each([[null], [undefined], [42], [{}], [["a"]]])("%p is not an id", (v) => {
    expect(isWorkspaceId(v)).toBe(false);
  });

  test("a guard cannot tell one brand from another — brands are erased", () => {
    // Stated as a test so nobody later mistakes these for discriminators and
    // routes on them. If you need to know WHICH kind of id you hold, the type
    // system is the only thing that knows.
    const raw = "id_123";
    expect(isWorkspaceId(raw)).toBe(true);
    expect(isProjectId(raw)).toBe(true);
    expect(isAccountId(raw)).toBe(true);
    expect(isVisitId(raw)).toBe(true);
    expect(isPersonId(raw)).toBe(true);
  });
});

describe("constructors are pass-through and unbrand reverses them", () => {
  test("the raw value survives", () => {
    expect(unbrand(WorkspaceId("w_1"))).toBe("w_1");
    expect(unbrand(ProjectId("p_1"))).toBe("p_1");
    expect(unbrand(PersonId("customer-42"))).toBe("customer-42");
  });

  test("equality is plain string equality at runtime", () => {
    expect(WorkspaceId("w_1") === WorkspaceId("w_1")).toBe(true);
  });
});

describe("assertNever", () => {
  type Shape = { kind: "circle" } | { kind: "square" };

  const area = (s: Shape): number => {
    switch (s.kind) {
      case "circle":
        return 1;
      case "square":
        return 2;
      default:
        return assertNever(s);
    }
  };

  test("every declared variant is handled", () => {
    expect(area({ kind: "circle" })).toBe(1);
    expect(area({ kind: "square" })).toBe(2);
  });

  test("an undeclared variant throws instead of falling through silently", () => {
    expect(() => area({ kind: "triangle" } as unknown as Shape)).toThrow();
  });
});
