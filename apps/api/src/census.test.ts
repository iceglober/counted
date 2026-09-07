/**
 * The route census: every route this server mounts is described by the
 * contract, and every route the contract describes is mounted. Both directions.
 *
 * One direction alone proves nothing useful. "Everything mounted is described"
 * is satisfied by a server that mounts nothing; "everything described is
 * mounted" is satisfied by a server that also mounts a dozen undocumented
 * endpoints. v2 had both failures at once — `/v1/workspaces/{id}/credentials`
 * answered requests it was not documented for, and half the dashboard write
 * surface was in the aggregate with no route to reach it.
 *
 * The third assertion is the one that catches the mistake this server's own
 * shape makes possible: a hand-written route whose path the contract also
 * describes. Hono matches in registration order and the hand-written ones are
 * registered first, so such a route would silently answer instead of the
 * documented procedure, and the OpenAPI document would describe something the
 * server never runs.
 */

import { describe, expect, test } from "bun:test";
import { contract, requirements, INGESTION_PATHS } from "@counted/contract";
import { HAND_WRITTEN_PATHS } from "./server";
import { HEALTH_PATH } from "./health";
import { createRouter } from "./router";
import { authorizeDeps } from "./index";
import { testDependencies } from "./testing";
import document from "../../../openapi.json" with { type: "json" };

/** Every dotted operation id in a router-shaped tree. */
const operationIds = (tree: unknown, prefix: readonly string[] = []): string[] => {
  if (tree === null || typeof tree !== "object") return [];
  const node = tree as Record<string, unknown>;
  // A procedure carries oRPC's internal marker; a namespace does not.
  if ("~orpc" in node) return [prefix.join(".")];
  return Object.entries(node).flatMap(([key, value]) => operationIds(value, [...prefix, key]));
};

const mounted = (): string[] => {
  const deps = testDependencies();
  return operationIds(createRouter(deps, authorizeDeps(deps))).sort();
};

const described = (): string[] => operationIds(contract).sort();

describe("the route census", () => {
  test("every mounted procedure is described by the contract", () => {
    const undocumented = mounted().filter((id) => !described().includes(id));
    expect(undocumented).toEqual([]);
  });

  test("every procedure the contract describes is mounted", () => {
    const unimplemented = described().filter((id) => !mounted().includes(id));
    expect(unimplemented).toEqual([]);
  });

  test("the two sets are the same set, not merely the same size", () => {
    expect(mounted()).toEqual(described());
  });

  test("every mounted procedure has an authorization requirement", () => {
    const missing = mounted().filter((id) => requirements.get(id) === undefined);
    expect(missing).toEqual([]);
  });

  /**
   * The collision check. A hand-written path that the contract also describes
   * would shadow the documented procedure, because Hono matches in registration
   * order and these are registered first.
   */
  test("no hand-written route shadows a contract route", () => {
    const dedicatedPaths = new Set(Object.keys(INGESTION_PATHS));
    const contractPaths = new Set(Object.keys(document.paths).filter((path) => !dedicatedPaths.has(path)));
    const shadowed = HAND_WRITTEN_PATHS.filter((path) => contractPaths.has(path));
    expect(shadowed).toEqual([]);
  });

  test("every documented dedicated transport is actually mounted", () => {
    for (const path of Object.keys(INGESTION_PATHS)) expect(HAND_WRITTEN_PATHS).toContain(path);
  });

  /**
   * The deployed v2 answered `/health` while its Railway check pointed at
   * `/v1/health`, which 404'd — so every deploy waited out the check's timeout
   * and a broken instance looked exactly like a working one.
   */
  test("the health path is /health and the contract does not describe it", () => {
    expect(HEALTH_PATH).toBe("/health");
    expect(Object.keys(document.paths)).not.toContain("/health");
  });

  test("the generated document has one operation per procedure or dedicated transport", () => {
    const ids = Object.values(document.paths).flatMap((item) =>
      Object.values(item as Record<string, { operationId?: string }>)
        .map((operation) => operation.operationId)
        .filter((id): id is string => typeof id === "string"),
    );
    const dedicated = Object.values(INGESTION_PATHS).flatMap((path) => Object.values(path).map((operation) => operation.operationId));
    expect(ids.sort()).toEqual([...described(), ...dedicated].sort());
  });
});
