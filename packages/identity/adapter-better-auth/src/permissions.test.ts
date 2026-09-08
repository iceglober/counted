import { describe, expect, test } from "bun:test";
import { ALL_PERMISSIONS, type Permission } from "@counted/kernel";
import { fromStatements, parsePermissions, toStatements } from "./permissions";

describe("the permission representation better-auth stores", () => {
  test("every permission survives the round trip", () => {
    expect(fromStatements(toStatements(ALL_PERMISSIONS))).toEqual(ALL_PERMISSIONS);
  });

  test("actions are grouped under their resource", () => {
    expect(toStatements(["billing:read", "billing:write", "queries:run"])).toEqual({
      queries: ["run"],
      billing: ["read", "write"],
    });
  });

  test("the result is ordered by ALL_PERMISSIONS, not by the input", () => {
    // Two implementations that agree on the set must also agree on the array,
    // or the contract suite's `toEqual` comparisons become order-dependent.
    const scrambled: readonly Permission[] = ["workspace:read", "events:write", "queries:run"];
    expect(fromStatements(toStatements(scrambled))).toEqual([
      "events:write",
      "queries:run",
      "workspace:read",
    ]);
  });

  test("a permission the kernel no longer knows is dropped, not fatal", () => {
    // The input is a JSON blob from a row that may predate a rename. Losing
    // that one authority is right; failing to verify the key at all is not.
    expect(fromStatements({ events: ["write"], sorcery: ["cast"] })).toEqual(["events:write"]);
    expect(fromStatements({ events: ["write", "levitate"] })).toEqual(["events:write"]);
  });

  test("garbage reads as no permissions rather than throwing", () => {
    expect(fromStatements(null)).toEqual([]);
    expect(fromStatements("nope")).toEqual([]);
    expect(fromStatements({ events: "write" })).toEqual([]);
    expect(parsePermissions("{not json")).toEqual([]);
    expect(parsePermissions(undefined)).toEqual([]);
  });

  test("the column is read whether the driver parsed it or not", () => {
    // The plugin JSON-encodes on write and hands the value back parsed on some
    // paths and raw on others.
    expect(parsePermissions('{"events":["write"]}')).toEqual(["events:write"]);
    expect(parsePermissions({ events: ["write"] })).toEqual(["events:write"]);
  });
});
