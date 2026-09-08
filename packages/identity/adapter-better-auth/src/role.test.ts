import { describe, expect, test } from "bun:test";
import { ROLES } from "@counted/kernel";
import { roleFrom, roleTo } from "./role";

describe("reading better-auth's role column", () => {
  for (const role of ROLES) {
    test(`round-trips ${role}`, () => {
      expect(roleFrom(roleTo(role))).toBe(role);
    });
  }

  test("a role this system has no rule for is not a membership", () => {
    // Reading it as `member` would hand out the member grant because somebody
    // typed a role name into the database.
    expect(roleFrom("billing-viewer")).toBeNull();
    expect(roleFrom("")).toBeNull();
    expect(roleFrom(null)).toBeNull();
    expect(roleFrom(undefined)).toBeNull();
  });

  test("several roles at once read as the strongest", () => {
    // better-auth comma-separates and its own check succeeds if ANY of them
    // authorizes. Reading the weakest would make this directory disagree with
    // the vendor about the same row.
    expect(roleFrom("member,owner")).toBe("owner");
    expect(roleFrom("owner,member")).toBe("owner");
    expect(roleFrom("member,admin")).toBe("admin");
  });

  test("unknown roles alongside known ones are ignored, not fatal", () => {
    expect(roleFrom("billing-viewer,admin")).toBe("admin");
    expect(roleFrom(" admin , billing-viewer ")).toBe("admin");
  });
});
