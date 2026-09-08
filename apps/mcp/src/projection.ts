/**
 * Contract procedure -> MCP tool.
 *
 * Nothing here authors a description or an argument shape. The tool's
 * description is the contract's summary and description; the tool's input
 * schema *is* the procedure's input schema object, handed to the SDK by
 * reference. That is possible because Zod 4 implements Standard Schema's
 * `~standard.jsonSchema`, which is exactly what `registerTool` asks for — so
 * the JSON Schema an agent reads in `tools/list` and the JSON Schema
 * `apps/api` validates against are the same value, not two renderings of one
 * idea.
 *
 * The one thing that *is* computed here is the tool name, from the operation
 * id. `dashboards.setDefault` becomes `dashboards_set_default`, because MCP
 * tool names are matched against `[a-zA-Z0-9_-]` by most clients and a dot is
 * not in it. Deriving it means renaming a procedure renames its tool.
 */

import { getProcedureContractOrThrow, type AnyContractProcedure } from "@orpc/contract";
import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { getOpenAPIMeta } from "@orpc/openapi";
import { contract, requirementFor, type AuthorizationRequirement } from "@counted/contract";
import { EXPOSED, type Exposure } from "./exposure";

/**
 * A schema that can both validate a value and describe itself as JSON Schema —
 * the shape `McpServer.registerTool` requires, and the shape Zod 4 happens to
 * have. The type `@orpc/contract` hands us (`AnySchema`) promises only the
 * validate half, so this is the narrowing between the two. Using the SDK's own
 * type rather than a hand-written structural copy means the projection cannot
 * produce something `registerTool` will not take.
 */
export type ToolSchema = StandardSchemaWithJSON<unknown, unknown>;

const bearsJsonSchema = (schema: unknown): schema is ToolSchema => {
  if (typeof schema !== "object" || schema === null || !("~standard" in schema)) return false;
  const standard: unknown = (schema as { "~standard": unknown })["~standard"];
  if (typeof standard !== "object" || standard === null) return false;
  const { validate, jsonSchema } = standard as { validate?: unknown; jsonSchema?: unknown };
  if (typeof validate !== "function") return false;
  return (
    typeof jsonSchema === "object" &&
    jsonSchema !== null &&
    typeof (jsonSchema as { input?: unknown }).input === "function"
  );
};

/** How one query parameter is spelled on the wire. oRPC's vocabulary, narrowed to the styles this contract uses. */
export type QueryStyle =
  | "primitive"
  | "array"
  | "comma-delimited-array"
  | "comma-delimited-object"
  | "json";

const QUERY_STYLES: readonly QueryStyle[] = [
  "primitive",
  "array",
  "comma-delimited-array",
  "comma-delimited-object",
  "json",
];

const isQueryStyle = (value: unknown): value is QueryStyle =>
  typeof value === "string" && (QUERY_STYLES as readonly string[]).includes(value);

/** Everything the HTTP invoker needs to turn an argument object into a request. */
export type RouteShape = {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** `{braces}`, as declared. */
  readonly path: string;
  /** Path parameter names, in path order. */
  readonly pathParams: readonly string[];
  /** Query parameter names and how each is spelled. */
  readonly query: Readonly<Record<string, QueryStyle>>;
};

/** One projected tool: everything `server.ts` needs, and nothing it has to invent. */
export type Tool = {
  /** The MCP tool name, derived from the operation id. */
  readonly name: string;
  /** The operation id, which is also the key of the authorization requirement. */
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly route: RouteShape;
  readonly inputSchema: ToolSchema;
  /**
   * The reply's declared shape, when the procedure has one that can describe
   * itself. Registered as the tool's `outputSchema`, so an agent can read what
   * comes back before it calls rather than after.
   */
  readonly outputSchema: ToolSchema | undefined;
  /**
   * Behavioural hints, derived from the HTTP method rather than declared. A GET
   * changes nothing; a DELETE destroys; a PUT is idempotent. The method already
   * carries all three and a second declaration would eventually disagree.
   */
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
  };
  /**
   * The requirement `apps/api` will enforce. Carried so the tool description can
   * *tell* an agent which permission a refusal will be about. It is never
   * evaluated here — see `server.ts`.
   */
  readonly requirement: AuthorizationRequirement | undefined;
};

/**
 * `dashboards.setDefault` -> `dashboards_set_default`.
 *
 * Lowercase, underscore-separated, no dots. Injectivity is not obvious from the
 * transform (two ids could in principle collide), so `projection.test.ts`
 * asserts it over the real contract rather than assuming it.
 */
export const toolNameOf = (operationId: string): string =>
  operationId
    .split(".")
    .map((segment) => segment.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase())
    .join("_");

/** The permission a requirement names, phrased for a tool description. */
const permissionSentence = (requirement: AuthorizationRequirement | undefined): string => {
  if (requirement === undefined) return "";
  switch (requirement.kind) {
    case "anonymous":
      return "\n\nNeeds no credential.";
    case "share":
      return "";
    case "account":
      return "\n\nNeeds any signed-in identity.";
    case "credential":
      return "\n\nNeeds any live credential.";
    case "principal":
      return `\n\nNeeds \`${requirement.permission}\` somewhere the caller reaches.`;
    case "resource":
      return `\n\nNeeds \`${requirement.permission}\` on the ${requirement.resource} named by \`${requirement.param}\`.`;
  }
};

/**
 * `{braces}` in path order. Written here rather than taken from
 * `getDynamicPathParams` because that helper reports a richer record than this
 * needs and its shape is not part of oRPC's documented surface.
 */
const pathParamsOf = (path: string): readonly string[] =>
  [...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => name as string);

/** Thrown at import when the contract and this server disagree about a route. */
export class ProjectionError extends Error {}

const shapeOf = (id: string, procedure: AnyContractProcedure): RouteShape => {
  const meta: unknown = getOpenAPIMeta(procedure);
  if (typeof meta !== "object" || meta === null) {
    throw new ProjectionError(`${id} carries no openapi() meta, so it has no HTTP shape to call.`);
  }
  const { method, path, queryStyles } = meta as {
    method?: unknown;
    path?: unknown;
    queryStyles?: unknown;
  };
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new ProjectionError(`${id} declares no path.`);
  }
  if (
    method !== "GET" &&
    method !== "POST" &&
    method !== "PUT" &&
    method !== "PATCH" &&
    method !== "DELETE"
  ) {
    throw new ProjectionError(`${id} declares an unusable method: ${String(method)}`);
  }

  const query: Record<string, QueryStyle> = {};
  if (queryStyles !== undefined) {
    if (typeof queryStyles !== "object" || queryStyles === null) {
      throw new ProjectionError(`${id} declares queryStyles that is not an object.`);
    }
    for (const [name, style] of Object.entries(queryStyles as Record<string, unknown>)) {
      if (!isQueryStyle(style)) {
        // A style this server cannot encode would silently send the parameter
        // in a spelling the API decodes as something else. Refuse at import.
        throw new ProjectionError(`${id} spells query parameter '${name}' as '${String(style)}', which this server cannot encode.`);
      }
      query[name] = style;
    }
  }

  return { method, path, pathParams: pathParamsOf(path), query };
};

/** Projects one exposure. Throws if the contract does not have such a procedure. */
export const project = (exposure: Exposure): Tool => {
  // Throws if the id is not a procedure — which is the whole check the
  // assignment asks a test to make, done at import for the real server too.
  const procedure = getProcedureContractOrThrow(contract, exposure.id.split("."));

  const meta: unknown = getOpenAPIMeta(procedure);
  const summary =
    typeof meta === "object" && meta !== null && typeof (meta as { summary?: unknown }).summary === "string"
      ? ((meta as { summary: string }).summary)
      : exposure.title;
  const detail =
    typeof meta === "object" && meta !== null && typeof (meta as { description?: unknown }).description === "string"
      ? `\n\n${(meta as { description: string }).description}`
      : "";

  const schemas = procedure["~orpc"].inputSchemas;
  const inputSchema = schemas?.[0];
  if (inputSchema === undefined || !bearsJsonSchema(inputSchema)) {
    throw new ProjectionError(
      `${exposure.id} has no input schema that can describe itself as JSON Schema, so its tool would take undocumented arguments.`,
    );
  }

  const outputCandidate = procedure["~orpc"].outputSchemas?.[0];
  const outputSchema = bearsJsonSchema(outputCandidate) ? outputCandidate : undefined;

  const route = shapeOf(exposure.id, procedure);
  const requirement = requirementFor(exposure.id.split("."));

  return {
    name: toolNameOf(exposure.id),
    id: exposure.id,
    title: exposure.title,
    description:
      summary +
      detail +
      (exposure.hint === undefined ? "" : `\n\n${exposure.hint}`) +
      permissionSentence(requirement),
    route,
    inputSchema,
    outputSchema,
    annotations: {
      readOnlyHint: route.method === "GET",
      destructiveHint: route.method === "DELETE",
      idempotentHint: route.method === "GET" || route.method === "PUT" || route.method === "DELETE",
    },
    requirement,
  };
};

/**
 * Every exposed tool, projected once at module load.
 *
 * Eager on purpose: a contract change that breaks the projection should stop
 * the process from starting, not surface as one broken tool on the day
 * somebody calls it.
 */
export const TOOLS: readonly Tool[] = EXPOSED.map(project);

export const TOOLS_BY_NAME: ReadonlyMap<string, Tool> = new Map(
  TOOLS.map((tool) => [tool.name, tool]),
);
