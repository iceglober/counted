/**
 * What the projection must be true of.
 *
 * The load-bearing property is that nothing here is a copy: a tool's arguments
 * are the contract's schema *object*, not a rendering of it, so there is no
 * second description to drift. Several tests below assert reference identity
 * rather than deep equality for exactly that reason — a deep-equality test
 * would pass on a copy, which is the failure worth catching.
 */

import { describe, expect, test } from "bun:test";
import { getProcedureContractOrThrow } from "@orpc/contract";
import { getOpenAPIMeta } from "@orpc/openapi";
import { contract, requirements } from "@counted/contract";
import { EXPOSED, WITHHELD } from "./exposure";
import { project, TOOLS, TOOLS_BY_NAME, toolNameOf } from "./projection";

/** Every procedure in the contract, addressed the way the contract addresses it. */
const procedureIds = (node: unknown, prefix: readonly string[] = []): string[] => {
  if (typeof node !== "object" || node === null) return [];
  if ("~orpc" in node) return [prefix.join(".")];
  return Object.entries(node).flatMap(([key, value]) => procedureIds(value, [...prefix, key]));
};

const ALL = procedureIds(contract);

describe("every exposed tool maps to a real contract procedure", () => {
  test("each exposed id resolves to a procedure", () => {
    // `getProcedureContractOrThrow` throws on a router or a missing key, so this
    // is the same check the real server makes at import — stated here so the
    // failure names the tool rather than crashing a process at boot.
    for (const { id } of EXPOSED) {
      expect(() => getProcedureContractOrThrow(contract, id.split("."))).not.toThrow();
    }
  });

  test("there is exactly one tool per exposure, and no tool without one", () => {
    expect(TOOLS.length).toBe(EXPOSED.length);
    expect([...TOOLS].map((t) => t.id).sort()).toEqual([...EXPOSED].map((e) => e.id).sort());
  });

  test("projecting an id the contract does not have fails loudly", () => {
    // The guard against the table and the contract drifting apart. Silence here
    // would mean a renamed procedure quietly loses its tool.
    expect(() => project({ id: "dashboards.doesNotExist", title: "x" })).toThrow();
    // A router is not a procedure, and would otherwise project to a tool with
    // no method, no path and no schema.
    expect(() => project({ id: "dashboards", title: "x" })).toThrow();
  });

  test("every tool carries the authorization requirement the API will enforce", () => {
    for (const tool of TOOLS) {
      expect(requirements.has(tool.id)).toBe(true);
      expect(tool.requirement).toEqual(requirements.get(tool.id));
    }
  });
});

describe("the exposure decision", () => {
  test("exposed and withheld together account for every procedure, exactly once", () => {
    // The point: adding a route to the contract fails this test until somebody
    // decides whether an agent gets it. Defaulting either way is the failure —
    // silently exposing a new write surface, or silently hiding a useful one.
    const exposed = EXPOSED.map((e) => e.id);
    const withheld = WITHHELD.map((w) => w.id);
    expect([...exposed, ...withheld].sort()).toEqual([...ALL].sort());
    expect(new Set([...exposed, ...withheld]).size).toBe(ALL.length);
  });

  test("nothing is both exposed and withheld", () => {
    const withheld = new Set(WITHHELD.map((w) => w.id));
    for (const { id } of EXPOSED) expect(withheld.has(id)).toBe(false);
  });

  test("every withholding gives a reason", () => {
    for (const { id, because } of WITHHELD) {
      expect(because.length, id).toBeGreaterThan(20);
    }
  });

  test("no tool is authorized by a share token", () => {
    // A share-token route is authorized by the link, not by the caller. If one
    // were exposed, "every tool runs as the caller" would stop being true and
    // this server would have a second way in.
    for (const tool of TOOLS) expect(tool.requirement?.kind).not.toBe("share");
  });
});

describe("names", () => {
  test("are derived from the operation id, not written down", () => {
    expect(toolNameOf("dashboards.setDefault")).toBe("dashboards_set_default");
    expect(toolNameOf("monitors.listForProject")).toBe("monitors_list_for_project");
    expect(toolNameOf("account.me")).toBe("account_me");
  });

  test("are unique across the exposed set", () => {
    // Derivation is lossy in principle — `a.bC` and `a.b_c` would collide. The
    // contract is the only place that can tell us whether it is lossy in fact.
    expect(TOOLS_BY_NAME.size).toBe(TOOLS.length);
  });

  test("use only characters MCP clients accept in a tool name", () => {
    for (const tool of TOOLS) expect(tool.name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
  });
});

describe("descriptions and schemas come from the contract", () => {
  test("the tool's input schema is the procedure's schema object itself", () => {
    for (const tool of TOOLS) {
      const procedure = getProcedureContractOrThrow(contract, tool.id.split("."));
      // Reference identity, not deep equality: a deep-equality assertion would
      // pass on a hand-maintained copy, and a copy is the thing that drifts.
      expect(tool.inputSchema).toBe(procedure["~orpc"].inputSchemas?.[0] as never);
    }
  });

  test("the tool's output schema is the procedure's, when it has one", () => {
    for (const tool of TOOLS) {
      const procedure = getProcedureContractOrThrow(contract, tool.id.split("."));
      const declared = procedure["~orpc"].outputSchemas?.[0];
      if (tool.outputSchema !== undefined) expect(tool.outputSchema).toBe(declared as never);
    }
  });

  test("the description opens with the contract's own summary", () => {
    for (const tool of TOOLS) {
      const meta = getOpenAPIMeta(getProcedureContractOrThrow(contract, tool.id.split("."))) as {
        summary?: string;
      } | null;
      expect(tool.description.startsWith(meta?.summary ?? "")).toBe(true);
    }
  });

  test("a description that names a permission names the one the API checks", () => {
    for (const tool of TOOLS) {
      const requirement = tool.requirement;
      if (requirement?.kind === "principal" || requirement?.kind === "resource") {
        expect(tool.description).toContain(`\`${requirement.permission}\``);
      }
    }
  });
});

describe("route shapes", () => {
  test("every {param} in a path is a required field of the input schema", () => {
    // oRPC hard-errors on this at document generation, but the projection reads
    // the path independently — so a param the schema does not carry would show
    // up here as a tool that always fails with MissingPathParam.
    for (const tool of TOOLS) {
      const json = tool.inputSchema["~standard"].jsonSchema.input({ target: "draft-2020-12" });
      const required = new Set((json["required"] as string[] | undefined) ?? []);
      for (const param of tool.route.pathParams) {
        expect(required.has(param), `${tool.id} needs ${param}`).toBe(true);
      }
    }
  });

  test("every declared query parameter is a field of the input schema", () => {
    for (const tool of TOOLS) {
      const json = tool.inputSchema["~standard"].jsonSchema.input({ target: "draft-2020-12" });
      const properties = (json["properties"] as Record<string, unknown> | undefined) ?? {};
      for (const name of Object.keys(tool.route.query)) {
        expect(Object.hasOwn(properties, name), `${tool.id} query ${name}`).toBe(true);
      }
    }
  });

  test("a GET carries nothing but path and declared query parameters", () => {
    // If it did, `buildRequest` would have to invent a spelling for the rest,
    // and oRPC's default bracket notation is not what the document advertises.
    for (const tool of TOOLS) {
      if (tool.route.method !== "GET") continue;
      const json = tool.inputSchema["~standard"].jsonSchema.input({ target: "draft-2020-12" });
      const properties = Object.keys((json["properties"] as Record<string, unknown>) ?? {});
      for (const field of properties) {
        const accounted =
          tool.route.pathParams.includes(field) || Object.hasOwn(tool.route.query, field);
        expect(accounted, `${tool.id}.${field}`).toBe(true);
      }
    }
  });
});

describe("behavioural hints are derived from the method", () => {
  test("a GET is read-only and never destructive", () => {
    for (const tool of TOOLS) {
      if (tool.route.method !== "GET") continue;
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
    }
  });

  test("nothing that writes claims to be read-only", () => {
    for (const tool of TOOLS) {
      if (tool.route.method === "GET") continue;
      expect(tool.annotations.readOnlyHint).toBe(false);
    }
  });
});
