/**
 * Registration.
 *
 * The result-shaping behaviour this file used to reach for is asserted in
 * `handler.test.ts` instead, through a real JSON-RPC request — `McpServer` has
 * no public "call this tool" entry point, and a test that reached into its
 * private registry would be asserting against an implementation detail rather
 * than against what a client sees.
 */

import { describe, expect, test } from "bun:test";
import type { ContractInvoker } from "./invoke";
import { TOOLS, TOOLS_BY_NAME, type Tool } from "./projection";
import { buildServer, INSTRUCTIONS } from "./server";

const silent: ContractInvoker = { invoke: async () => ({ kind: "unreachable", because: "" }) };

const tool = (name: string): Tool => {
  const found = TOOLS_BY_NAME.get(name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
};

describe("registration", () => {
  test("a tool registers under its derived name, with the contract's argument schema", () => {
    const server = buildServer({ invoker: silent, token: undefined, tools: [tool("workspaces_list")] });
    const json = server.toolInputSchemaJson("workspaces_list");
    expect(json).toBeDefined();
    expect(json?.["type"]).toBe("object");
    // The withheld half of the contract is not reachable by name.
    expect(server.toolInputSchemaJson("workspaces_delete")).toBeUndefined();
  });

  test("the whole exposed set registers without a name collision", () => {
    // `registerTool` throws on a duplicate, which is the runtime half of the
    // uniqueness the projection asserts statically. Worth having both: the
    // static one names the clash, this one proves the SDK agrees.
    expect(() => buildServer({ invoker: silent, token: undefined })).not.toThrow();
    const server = buildServer({ invoker: silent, token: undefined });
    for (const t of TOOLS) expect(server.toolInputSchemaJson(t.name)).toBeDefined();
  });

  test("the instructions tell an agent to read the project's schema before writing an analysis", () => {
    // Not decoration. An analysis naming an event the project has never seen is
    // refused as unanswerable, and `queries_schema` is the only way to find out
    // which names exist — an agent that does not know that burns turns.
    expect(INSTRUCTIONS).toContain("queries_schema");
  });
});
