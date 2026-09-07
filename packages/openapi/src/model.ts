import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";

export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type Schema = {
  [key: string]: unknown;
  $ref?: string;
  title?: string;
  description?: string;
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  additionalProperties?: boolean | Schema;
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
  enum?: Json[];
  const?: Json;
  default?: Json;
  examples?: Json[];
  minimum?: number;
  exclusiveMinimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  format?: string;
};
export type Parameter = {
  $ref?: string;
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: Schema;
  content?: Record<string, { schema?: Schema }>;
  style?: string;
  explode?: boolean;
};
export type Operation = {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  description?: string;
  tags?: string[];
  parameters: Parameter[];
  requestBody?: {
    $ref?: string;
    required?: boolean;
    content: Record<string, { schema?: Schema }>;
  };
  responses?: Record<string, unknown>;
  security?: Record<string, string[]>[];
};
export type ApiDocument = {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: { url: string }[];
  tags?: { name: string; description?: string }[];
  paths: Record<string, Record<string, unknown>>;
  components?: {
    schemas?: Record<string, Schema>;
    securitySchemes?: Record<
      string,
      {
        type: string;
        in?: string;
        name?: string;
        description?: string;
        scheme?: string;
      }
    >;
  };
  security?: Record<string, string[]>[];
};

function localRef<T>(document: ApiDocument, source: T & { $ref?: string }): T {
  if (!source.$ref) return source;
  if (!source.$ref.startsWith("#/"))
    throw new Error("Only local OpenAPI references are supported.");
  let value: unknown = document;
  for (const part of source.$ref.slice(2).split("/")) {
    const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key))
      throw new Error(`Missing OpenAPI reference: ${source.$ref}`);
    value = (value as Record<string, unknown>)[key];
  }
  const { $ref: _, ...siblings } = source;
  return { ...(value as T), ...siblings };
}

export function resolveSchema(document: ApiDocument, source: Schema): Schema {
  let schema = source;
  const seen = new Set<string>();
  while (schema.$ref) {
    if (seen.has(schema.$ref))
      throw new Error("Circular OpenAPI reference without a schema.");
    seen.add(schema.$ref);
    schema = localRef(document, schema);
  }
  if (schema.allOf) {
    const parts = schema.allOf.map((part) => resolveSchema(document, part));
    return {
      ...schema,
      properties: Object.assign(
        {},
        ...parts.map((part) => part.properties),
        schema.properties,
      ),
      required: [
        ...new Set(
          parts
            .flatMap((part) => part.required ?? [])
            .concat(schema.required ?? []),
        ),
      ],
    };
  }
  return schema;
}

export function operationsOf(document: ApiDocument): Operation[] {
  const methods = new Set([
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "head",
    "options",
    "trace",
  ]);
  return Object.entries(document.paths).flatMap(([path, item]) =>
    Object.entries(item).flatMap(([method, source]) => {
      if (!methods.has(method) || !source || typeof source !== "object")
        return [];
      const operation = source as Partial<Operation>;
      const parameters = [
        ...((item.parameters as Parameter[] | undefined) ?? []),
        ...(operation.parameters ?? []),
      ].map((parameter) => localRef(document, parameter));
      const deduplicated = [
        ...new Map(
          parameters.map((parameter) => [
            `${parameter.in}:${parameter.name}`,
            parameter,
          ]),
        ).values(),
      ];
      return [
        {
          ...operation,
          path,
          method: method.toUpperCase(),
          operationId: operation.operationId ?? `${method}:${path}`,
          summary: operation.summary ?? `${method.toUpperCase()} ${path}`,
          parameters: deduplicated,
          ...(operation.requestBody
            ? { requestBody: localRef(document, operation.requestBody) }
            : {}),
        },
      ];
    }),
  );
}

/** The first OpenAPI tag is an operation's resource; document order is navigation order. */
export function operationGroupsOf(document: ApiDocument) {
  const groups = new Map(
    (document.tags ?? []).map((tag) => [
      tag.name,
      { ...tag, operations: [] as Operation[] },
    ]),
  );
  for (const operation of operationsOf(document)) {
    const name = operation.tags?.[0] ?? "other";
    let group = groups.get(name);
    if (!group) {
      group = { name, operations: [] };
      groups.set(name, group);
    }
    group.operations.push(operation);
  }
  return [...groups.values()].filter((group) => group.operations.length > 0);
}

export const parameterSchema = (parameter: Parameter): Schema =>
  parameter.schema ??
  parameter.content?.["application/json"]?.schema ?? { type: "string" };
export const requestSchema = (operation: Operation): Schema | undefined =>
  operation.requestBody?.content["application/json"]?.schema;
const objectValue = (value: unknown): value is Record<string, Json> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function variantLabel(
  document: ApiDocument,
  source: Schema,
  index: number,
): string {
  const schema = resolveSchema(document, source);
  const discriminant = Object.values(schema.properties ?? {}).find(
    (field) => field.const !== undefined,
  )?.const;
  return (
    schema.title ??
    (discriminant !== undefined
      ? String(discriminant)
      : Array.isArray(schema.type)
        ? schema.type.join(" / ")
        : (schema.type ?? `Option ${index + 1}`))
  );
}

export function variantIndex(
  document: ApiDocument,
  variants: Schema[],
  value: Json | undefined,
): number {
  const match = variants.findIndex((source) => {
    const schema = resolveSchema(document, source);
    if (schema.const !== undefined) return schema.const === value;
    if (schema.type === "null") return value === null;
    if (schema.type === "array") return Array.isArray(value);
    if (schema.type === "object" || schema.properties) {
      if (!objectValue(value)) return false;
      return Object.entries(schema.properties ?? {}).every(
        ([key, field]) =>
          field.const === undefined || value[key] === field.const,
      );
    }
    return (
      typeof value === schema.type ||
      (schema.type === "integer" && typeof value === "number")
    );
  });
  return Math.max(0, match);
}

export function initialValue(
  document: ApiDocument,
  source: Schema,
  seeds: Record<string, Json> = {},
  depth = 0,
): Json {
  const schema = resolveSchema(document, source);
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length) return schema.enum[0]!;
  if (schema.oneOf ?? schema.anyOf)
    return initialValue(
      document,
      (schema.oneOf ?? schema.anyOf)![0]!,
      seeds,
      depth + 1,
    );
  const type = Array.isArray(schema.type)
    ? schema.type.find((type) => type !== "null")
    : schema.type;
  if (type === "object" || schema.properties) {
    if (depth > 12) return {};
    return Object.fromEntries(
      Object.entries(schema.properties ?? {})
        .filter(
          ([key]) => schema.required?.includes(key) || seeds[key] !== undefined,
        )
        .map(([key, field]) => [
          key,
          seeds[key] ?? initialValue(document, field, seeds, depth + 1),
        ]),
    );
  }
  if (type === "array")
    return Array.from({ length: Math.min(schema.minItems ?? 0, 20) }, () =>
      initialValue(document, schema.items ?? {}, seeds, depth + 1),
    );
  if (type === "boolean") return false;
  if (type === "number" || type === "integer")
    return (
      schema.minimum ??
      (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : 0)
    );
  if (type === "null") return null;
  return "";
}

const validators = new WeakMap<
  ApiDocument,
  Map<Schema, ReturnType<Ajv["compile"]>>
>();
export function validateValue(
  document: ApiDocument,
  schema: Schema,
  value: unknown,
): string[] {
  let cache = validators.get(document);
  if (!cache) {
    cache = new Map();
    validators.set(document, cache);
  }
  let validate = cache.get(schema);
  if (!validate) {
    const ajv = new Ajv({
      strict: false,
      allErrors: true,
      validateFormats: true,
    });
    addFormats(ajv);
    validate = ajv.compile({ ...schema, components: document.components });
    cache.set(schema, validate);
  }
  if (validate(value)) return [];
  const messages = [
    ...new Set(
      (validate.errors ?? [])
        .filter((error) => !["oneOf", "anyOf", "const"].includes(error.keyword))
        .map((error) => `${error.instancePath || "Value"} ${error.message}`),
    ),
  ].slice(0, 8);
  return messages.length ? messages : ["Value does not match the schema."];
}

export type RequestCredential =
  | { kind: "session" | "none" }
  | { kind: "bearer"; token: string }
  | { kind: "query"; name: string; token: string };
export function buildRequest(
  document: ApiDocument,
  operation: Operation,
  values: Record<string, Json | undefined>,
  body: Json | undefined,
  credential: RequestCredential,
): { url: string; init: RequestInit } {
  if (!operation.path.startsWith("/v1/") && operation.path !== "/v1")
    throw new Error("The Explorer only calls the Counted API.");
  let path = operation.path;
  const query = new URLSearchParams();
  const headers = new Headers({ accept: "application/json" });
  for (const parameter of operation.parameters) {
    const value = values[`${parameter.in}:${parameter.name}`];
    if (value === undefined) {
      if (parameter.required) throw new Error(`${parameter.name} is required.`);
      continue;
    }
    const defects = validateValue(document, parameterSchema(parameter), value);
    if (defects.length)
      throw new Error(`${parameter.name}: ${defects.join("; ")}`);
    if (parameter.in === "path") {
      if ([".", ".."].includes(String(value)))
        throw new Error(`${parameter.name} must not be a path segment.`);
      path = path.replaceAll(
        `{${parameter.name}}`,
        encodeURIComponent(String(value)),
      );
    } else if (parameter.in === "query") {
      if (parameter.content?.["application/json"])
        query.set(parameter.name, JSON.stringify(value));
      else if (Array.isArray(value)) {
        if (parameter.explode === false)
          query.set(parameter.name, value.map(String).join(","));
        else
          value.forEach((item) => query.append(parameter.name, String(item)));
      } else if (objectValue(value)) {
        for (const [key, item] of Object.entries(value))
          query.set(
            parameter.style === "deepObject"
              ? `${parameter.name}[${key}]`
              : key,
            String(item),
          );
      } else query.set(parameter.name, String(value));
    } else if (parameter.in === "header")
      headers.set(parameter.name, String(value));
    else
      throw new Error("Browser cookies are supplied by the current session.");
  }
  if (/\{[^}]+\}/.test(path)) throw new Error("Fill in every path parameter.");
  if (credential.kind === "bearer") {
    if (!credential.token.trim()) throw new Error("Enter an API key.");
    headers.set("authorization", `Bearer ${credential.token.trim()}`);
  }
  if (credential.kind === "query" && credential.token)
    query.set(credential.name, credential.token);
  const schema = requestSchema(operation);
  if (operation.requestBody?.required && body === undefined)
    throw new Error("A request body is required.");
  if (body !== undefined) {
    if (!schema) throw new Error("This operation does not accept a JSON body.");
    const defects = validateValue(document, schema, body);
    if (defects.length) throw new Error(`Request body: ${defects.join("; ")}`);
    headers.set("content-type", "application/json");
  }
  return {
    url: `/api${path}${query.size ? `?${query}` : ""}`,
    init: {
      method: operation.method,
      headers,
      credentials: credential.kind === "session" ? "same-origin" : "omit",
      redirect: "error",
      cache: "no-store",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  };
}

/** The API's hand-written routes use the same proxy, never an arbitrary host. */
export function buildCustomRequest(
  path: string,
  method: string,
  body: Json | undefined,
  credential: RequestCredential,
): { url: string; init: RequestInit } {
  const input = path.trim();
  if (!/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method))
    throw new Error("Choose a supported HTTP method.");
  const pathname = input.split("?")[0]!;
  if (
    input.includes("#") ||
    pathname.includes("\\") ||
    pathname.split("/").some((segment) => {
      try {
        return [".", ".."].includes(decodeURIComponent(segment));
      } catch {
        return true;
      }
    })
  )
    throw new Error(
      "Enter a valid API path without fragments or traversal segments.",
    );
  if (!pathname.startsWith("/v1/") && !pathname.startsWith("/api/auth/"))
    throw new Error("Use a /v1/ or /api/auth/ path.");
  if (pathname === "/v1/webhooks/stripe")
    throw new Error("Provider webhooks cannot be sent from the app.");
  if ((method === "GET" || method === "HEAD") && body !== undefined)
    throw new Error(`${method} requests cannot have a body.`);
  const request = buildRequest(
    { openapi: "3.1.2", info: { title: "Custom", version: "1" }, paths: {} },
    {
      operationId: "custom",
      summary: "Custom request",
      path: "/v1/custom",
      method,
      parameters: [],
      requestBody: { content: { "application/json": { schema: {} } } },
    },
    {},
    body,
    credential,
  );
  return {
    ...request,
    url: pathname.startsWith("/api/auth/") ? input : `/api${input}`,
  };
}
