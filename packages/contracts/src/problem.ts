/**
 * Building a problem document.
 *
 * One constructor. Everything else in the system picks an error code and hands
 * over a detail string; the status, title, type URI, docs link and
 * `retryable` flag all come from the registry, so a route cannot answer 403
 * with a body that says 404.
 *
 * `fields` is derived from a Zod error tree rather than written by hand. That
 * is the only reason field-level errors will actually exist on every endpoint
 * — v1's `unauthorized()` helper existed too, and was called in one of roughly
 * twenty places that needed it.
 */

import type { z, ZodError, ZodIssue } from "zod";
import type { FieldErrorSchema, ProblemSchema } from "./schemas/common";
import { definitionOf, docsUriFor, typeUriFor, type ErrorCode } from "./errors";

/**
 * The shapes come from the schemas, not from a parallel hand-written type.
 *
 * So the constructor below cannot produce something the schema would reject —
 * and a test asserts exactly that for every code in the registry.
 */
export type Problem = z.infer<typeof ProblemSchema>;
export type FieldError = z.infer<typeof FieldErrorSchema>;

export type ProblemOptions = {
  readonly detail?: string;
  readonly instance?: string;
  readonly fields?: readonly FieldError[];
  readonly retryAfter?: number;
};

export const problemFor = (code: ErrorCode, requestId: string, options: ProblemOptions = {}): Problem => {
  const definition = definitionOf(code);
  return {
    type: typeUriFor(code),
    title: definition.title,
    status: definition.status,
    code,
    // The registry summary is the fallback, so a problem is never detail-less
    // even when a call site forgets to say anything specific.
    detail: options.detail ?? definition.summary,
    requestId,
    retryable: definition.retryable,
    docs: docsUriFor(code),
    ...(options.instance === undefined ? {} : { instance: options.instance }),
    ...(options.fields === undefined || options.fields.length === 0 ? {} : { fields: [...options.fields] }),
    ...(options.retryAfter === undefined ? {} : { retryAfter: options.retryAfter }),
  };
};

/**
 * `events[1].name`, not `events.1.name`.
 *
 * A path a developer can paste back into their own code is worth the four
 * lines. An empty path means the failure is about the body as a whole.
 */
export const formatPath = (path: readonly (string | number | symbol)[]): string => {
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") out += `[${segment}]`;
    else out += out.length === 0 ? String(segment) : `.${String(segment)}`;
  }
  return out;
};

const allowedOf = (issue: ZodIssue): readonly string[] | undefined => {
  const candidate = issue as { options?: unknown; values?: unknown };
  const raw = candidate.options ?? candidate.values;
  if (!Array.isArray(raw)) return undefined;
  const strings = raw.filter((v): v is string => typeof v === "string");
  return strings.length === 0 ? undefined : strings;
};

/**
 * Every issue Zod found, flattened. Not just the first.
 *
 * Reporting one error at a time turns fixing a payload into a conversation.
 */
export const fieldsFrom = (error: ZodError): readonly FieldError[] =>
  error.issues.map((issue): FieldError => {
    const allowed = allowedOf(issue);
    return {
      path: formatPath(issue.path),
      code: issue.code,
      message: issue.message,
      ...(allowed === undefined ? {} : { allowed: [...allowed] }),
    };
  });

/** The detail line for a validation failure: a count, then the list does the work. */
export const validationDetail = (fields: readonly FieldError[]): string =>
  fields.length === 1 ? "1 field is invalid." : `${fields.length} fields are invalid.`;
