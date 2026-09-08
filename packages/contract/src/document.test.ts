/**
 * The contract's own proofs.
 *
 * These tests read the *generated document*, not the source that produced it.
 * That distinction is the whole value: asserting that a route object contains
 * the security block we put in it proves only that object spread works. The
 * document is the artifact four other things consume, and every property below
 * is one somebody downstream will assume without checking.
 *
 * Each test names the failure it prevents rather than the field it reads.
 */

import { describe, expect, test } from "bun:test";
import { getOpenAPIMeta, OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { contract } from "./index";
import { API_INFO, API_TAGS, SECURITY_SCHEME_DEFINITIONS } from "./document";
import { ORPC_ERROR_CODES, STATUS_OF_CODE } from "./errors";
import {
  SECURITY_SCHEMES,
  requirements,
  type AuthorizationRequirement,
} from "./authorization";

type Json = Record<string, unknown>;

const generator = new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] });

const document = (await generator.generate(contract, {
  base: {
    info: API_INFO,
    tags: [...API_TAGS],
    components: { securitySchemes: { ...SECURITY_SCHEME_DEFINITIONS } },
  },
})) as unknown as Json;

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

type Operation = {
  operationId?: string;
  summary?: string;
  tags?: string[];
  security?: Record<string, string[]>[];
  parameters?: { in: string; name: string; required?: boolean }[];
  requestBody?: Json;
  responses: Record<string, Json>;
  "x-counted-authorization"?: AuthorizationRequirement;
};

const paths = document["paths"] as Record<string, Record<string, Operation>>;

/** Every operation, with the path and method it was found at. */
const operations: { path: string; method: string; op: Operation }[] = [];
for (const [path, item] of Object.entries(paths)) {
  for (const method of HTTP_METHODS) {
    const op = item[method];
    if (op !== undefined) operations.push({ path, method, op });
  }
}

/**
 * Walks the contract tree. A procedure is a leaf carrying oRPC's internal
 * marker; everything else is a nested router.
 */
const procedurePaths = (node: unknown, prefix: readonly string[] = []): string[][] => {
  if (typeof node !== "object" || node === null) return [];
  if ("~orpc" in node) return [[...prefix]];
  return Object.entries(node).flatMap(([key, value]) => procedurePaths(value, [...prefix, key]));
};

const contractPaths = procedurePaths(contract).map((segments) => segments.join("."));

/** Every procedure, addressed the way the registry and the document address it. */
const procedures: [string, never][] = procedurePaths(contract).map((segments) => {
  let node: unknown = contract;
  for (const key of segments) node = (node as Record<string, unknown>)[key];
  return [segments.join("."), node as never];
});

const byId = new Map(operations.map(({ op }) => [op.operationId as string, op]));

describe("the document", () => {
  test("generates, and says which OpenAPI version it is", () => {
    // The generator emits 3.1.2 and has no 3.0 mode. A downstream tool that
    // only reads 3.0 needs converting, not configuring — worth failing loudly
    // if this ever silently changes.
    expect(document["openapi"]).toBe("3.1.2");
    expect(operations.length).toBeGreaterThan(40);
  });

  test("describes every procedure in the contract exactly once", () => {
    const ids = operations.map(({ op }) => op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...contractPaths].sort());
  });

  test("every operation has an operation id equal to its path in the tree", () => {
    // Generated clients name their methods from this. An operation id that
    // drifted from the tree would give the console a method that does not
    // correspond to the procedure it calls.
    for (const { op } of operations) {
      expect(typeof op.operationId).toBe("string");
      expect(contractPaths).toContain(op.operationId as string);
    }
  });

  test("every operation has a summary and a known tag", () => {
    const known = new Set(API_TAGS.map((t) => t.name));
    for (const { op, path, method } of operations) {
      expect(op.summary, `${method} ${path}`).toBeTruthy();
      expect(op.tags?.length, `${method} ${path}`).toBeGreaterThan(0);
      for (const tag of op.tags ?? []) expect(known).toContain(tag);
    }
  });
});

describe("path parameters", () => {
  test("every {param} in a path is a required path parameter of its operation", () => {
    // oRPC hard-errors at generation if a {param} is missing from the input
    // schema or is optional. Asserting it here turns a build failure into a
    // named test — and covers the case where a path is edited but its input is
    // not.
    for (const { path, method, op } of operations) {
      const braced = [...path.matchAll(/\{\+?([^}]+)\}/g)].map((m) => m[1]);
      const declared = (op.parameters ?? []).filter((p) => p.in === "path");
      expect(declared.map((p) => p.name).sort(), `${method} ${path}`).toEqual(
        [...braced].sort() as string[],
      );
      for (const p of declared) expect(p.required, `${method} ${path} ${p.name}`).toBe(true);
    }
  });

  test("no two operations could match the same request", () => {
    // `/v1/projects/provision` and `/v1/projects/{projectId}` are one edit away
    // from colliding. A static segment and a parameter at the same position,
    // under the same method, is a router that answers by luck.
    const shapes = new Map<string, string>();
    for (const { path, method, op } of operations) {
      const shape = `${method} ${path.replace(/\{\+?[^}]+\}/g, "*")}`;
      const previous = shapes.get(shape);
      expect(previous, `${shape} is matched by both ${previous} and ${op.operationId}`).toBe(
        undefined,
      );
      shapes.set(shape, op.operationId ?? path);
    }
  });
});

describe("authorization", () => {
  test("every procedure declares a requirement, and none is orphaned", () => {
    expect([...requirements.keys()].sort()).toEqual([...contractPaths].sort());
  });

  test("every operation carries its requirement in the document", () => {
    for (const { op, path, method } of operations) {
      const declared = requirements.get(op.operationId as string);
      expect(op["x-counted-authorization"], `${method} ${path}`).toEqual(
        declared as AuthorizationRequirement,
      );
    }
  });

  test("every scheme in the vocabulary has a definition in the document", () => {
    // `schemesFor` can name a scheme that components never defines, and a
    // document that references an undefined scheme fails validation in every
    // tool that reads it — after it has shipped.
    const defined = new Set(Object.keys(SECURITY_SCHEME_DEFINITIONS));
    for (const scheme of SECURITY_SCHEMES) expect(defined).toContain(scheme);
    expect(defined.size).toBe(SECURITY_SCHEMES.length);
  });

  test("every operation emits a security block, and every scheme it names is defined", () => {
    // v2 declared security twice with nothing comparing them, and the document
    // named a scheme the server did not accept for four months.
    const defined = new Set(Object.keys(SECURITY_SCHEME_DEFINITIONS));
    for (const { op, path, method } of operations) {
      expect(Array.isArray(op.security), `${method} ${path}`).toBe(true);
      for (const alternative of op.security ?? []) {
        for (const scheme of Object.keys(alternative)) {
          expect(defined, `${method} ${path}`).toContain(scheme);
        }
      }
    }
  });

  test("the resource a requirement names is a field the request actually carries", () => {
    // A requirement pointing at `workspaceId` on a route that only takes
    // `projectId` would leave apps/api authorizing against undefined — which
    // fails open unless someone remembered to check.
    for (const { op, path, method } of operations) {
      const requirement = op["x-counted-authorization"];
      if (requirement?.kind !== "resource") continue;
      const parameters = (op.parameters ?? []).map((p) => p.name);
      const body = op.requestBody as
        | { content?: { "application/json"?: { schema?: { properties?: Json } } } }
        | undefined;
      const bodyFields = Object.keys(
        body?.content?.["application/json"]?.schema?.properties ?? {},
      );
      expect(
        [...parameters, ...bodyFields],
        `${method} ${path} authorizes on ${requirement.param}`,
      ).toContain(requirement.param);
    }
  });

  test("only the provisioning route takes no credential", () => {
    // The no-signup path is the one place anonymity is the product. Anywhere
    // else it is a hole.
    const open = operations.filter(({ op }) => (op.security ?? []).length === 0);
    expect(open.map(({ op }) => op.operationId)).toEqual(["projects.provision"]);
  });

  test("an ingest key is offered only where events:write is the requirement", () => {
    for (const { op } of operations) {
      const offersIngest = (op.security ?? []).some((s) => "ingestKey" in s);
      const requirement = op["x-counted-authorization"];
      const isIngestPermission =
        (requirement?.kind === "resource" || requirement?.kind === "principal") &&
        requirement.permission === "events:write";
      const isSelfDescription = requirement?.kind === "credential";
      expect(offersIngest, op.operationId).toBe(isIngestPermission || isSelfDescription);
    }
  });
});

describe("errors", () => {
  test("every error response uses a status from oRPC's closed vocabulary", () => {
    // `.errors({ TOO_MANY_TILES: ... })` is a type error, but a hand-written
    // status in the document would not be. This checks the artifact.
    const allowed = new Set(
      ORPC_ERROR_CODES.map((code) => STATUS_OF_CODE[code]).filter(
        (status): status is number => status !== undefined,
      ),
    );
    for (const { op, path, method } of operations) {
      for (const status of Object.keys(op.responses)) {
        const numeric = Number(status);
        if (numeric < 400) continue;
        expect(allowed, `${method} ${path} -> ${status}`).toContain(numeric);
      }
    }
  });

  test("every authenticated operation can say 401 and 403", () => {
    for (const { op, path, method } of operations) {
      const requirement = op["x-counted-authorization"];
      if (requirement === undefined) continue;
      if (requirement.kind === "anonymous" || requirement.kind === "share") continue;
      expect(Object.keys(op.responses), `${method} ${path}`).toContain("401");
      expect(Object.keys(op.responses), `${method} ${path}`).toContain("403");
    }
  });

  test("a share link cannot tell you whether a dashboard exists", () => {
    // A wrong token and an unshared dashboard both answer 404. A 401 or a 403
    // on these routes would turn them into an oracle for which dashboards have
    // live links.
    const shared = operations.filter(
      ({ op }) => op["x-counted-authorization"]?.kind === "share",
    );
    expect(shared.length).toBeGreaterThan(0);
    for (const { op } of shared) {
      expect(Object.keys(op.responses), op.operationId).not.toContain("401");
      expect(Object.keys(op.responses), op.operationId).not.toContain("403");
      expect(Object.keys(op.responses), op.operationId).toContain("404");
    }
  });

  test("every error body is discriminated by a reason literal", () => {
    // The domain error's name travels in `data.reason`, never in the code. A
    // client that switches on `reason` needs it to be present on every branch.
    const schemas = (document["components"] as { schemas?: Record<string, Json> }).schemas ?? {};
    const errorSchemas = Object.entries(schemas).filter(([name]) => name !== "UndefinedError");
    const withData = errorSchemas.filter(([, schema]) => {
      const properties = (schema as { properties?: Record<string, Json> }).properties;
      return properties !== undefined && "code" in properties && "data" in properties;
    });
    expect(withData.length).toBeGreaterThan(0);
    for (const [name, schema] of withData) {
      const data = (schema as { properties: Record<string, Json> }).properties["data"] as Json;
      const branches = (data["anyOf"] ?? data["oneOf"] ?? [data]) as Json[];
      for (const branch of branches) {
        const properties = branch["properties"] as Record<string, Json> | undefined;
        expect(properties === undefined ? undefined : "reason" in properties, name).not.toBe(
          false,
        );
      }
    }
  });
});

describe("query parameters", () => {
  test("every query parameter names its style explicitly", () => {
    // oRPC's default for a query parameter is bracket notation
    // (`?a[]=1&a[]=2`), which is not OpenAPI-native: Scalar and Swagger UI
    // generate `?a=1&a=2` from the document and oRPC's own server then decodes
    // it as something else. The symptom is a request built from the spec that
    // the API rejects.
    //
    // For a scalar the two spellings coincide, so the generated document
    // cannot tell a declared style from a defaulted one. This compares the
    // declaration against the emitted parameters instead — which is the only
    // place the omission is visible before it ships.
    for (const [id, procedure] of procedures) {
      const meta = getOpenAPIMeta(procedure);
      const operation = byId.get(id);
      expect(operation, id).toBeDefined();
      const emitted = (operation?.parameters ?? [])
        .filter((p) => p.in === "query")
        .map((p) => p.name)
        .sort();
      expect(Object.keys(meta?.queryStyles ?? {}).sort(), id).toEqual(emitted);
    }
  });

  test("a query parameter that is not a scalar is not left on the default", () => {
    // This is where the default actually bites: an array or an object decoded
    // as brackets on one side and as a comma list on the other.
    for (const { op, path, method } of operations) {
      for (const parameter of op.parameters ?? []) {
        if (parameter.in !== "query") continue;
        const p = parameter as unknown as Json;
        const schema = p["schema"] as { type?: string } | undefined;
        const scalar =
          schema !== undefined &&
          ["string", "integer", "number", "boolean"].includes(schema.type ?? "");
        if (scalar) continue;
        const explicit = "content" in p || "style" in p || "explode" in p;
        expect(explicit, `${method} ${path} ?${parameter.name}`).toBe(true);
      }
    }
  });
});

describe("secrets", () => {
  test("a key's secret is returned by issuance and rotation only", () => {
    // v1's key list returned the full key for every key the caller could see.
    // `Credential` carries a hint; `IssuedCredential` carries the secret, and
    // this asserts which responses can reach it.
    const schemas = (document["components"] as { schemas: Record<string, Json> }).schemas;

    const reachable = (node: unknown, seen: Set<string>): boolean => {
      if (Array.isArray(node)) return node.some((item) => reachable(item, seen));
      if (typeof node !== "object" || node === null) return false;
      const entries = Object.entries(node as Json);
      for (const [key, value] of entries) {
        if (key === "$ref" && typeof value === "string") {
          const name = value.replace("#/components/schemas/", "");
          if (seen.has(name)) continue;
          seen.add(name);
          if (name.startsWith("IssuedCredential")) return true;
          if (reachable(schemas[name], seen)) return true;
          continue;
        }
        if (reachable(value, seen)) return true;
      }
      return false;
    };

    const carriers = operations
      .filter(({ op }) =>
        Object.entries(op.responses).some(
          ([status, body]) => Number(status) < 400 && reachable(body, new Set()),
        ),
      )
      .map(({ op }) => op.operationId)
      .sort();

    // Four, and the fourth is `credentials.issueForWorkspace` — the
    // workspace-wide service key, which is what lets a credential claim a
    // project. Anything else appearing in this list is a secret leaking into a
    // response that was never meant to carry one.
    expect(carriers).toEqual([
      "credentials.issue",
      "credentials.issueForWorkspace",
      "credentials.rotate",
      "projects.provision",
    ]);
  });

  test("the credential listing shape has no secret field", () => {
    const schemas = (document["components"] as { schemas: Record<string, Json> }).schemas;
    for (const [name, schema] of Object.entries(schemas)) {
      if (!name.startsWith("Credential")) continue;
      const properties = (schema as { properties?: Json }).properties ?? {};
      expect(Object.keys(properties), name).not.toContain("secret");
    }
  });
});
