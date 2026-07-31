/**
 * Parsing a request body against its contract schema.
 *
 * One copy. It was a local helper in `management.ts`, and the moment a second
 * route file needed it the obvious move was to paste it — which is how two
 * endpoints come to disagree about what a malformed body is.
 *
 * Two failures, kept apart: a body that is not JSON at all is a `400`, because
 * nothing about the request could be read; a body that parses but does not
 * match is a `422` listing **every** bad field at once, so a caller fixes them
 * in one round trip rather than discovering them one at a time.
 */

import type { Context } from "hono";
import { fieldsFrom, validationDetail } from "@counted/contracts";
import type { z } from "zod";
import type { ApiEnv } from "../server";
import { sendProblem } from "./respond";

type ParsedOf<S> = S extends { safeParse: (raw: unknown) => z.SafeParseReturnType<unknown, infer T> } ? T : never;

export const body = async <S extends { safeParse: (raw: unknown) => z.SafeParseReturnType<unknown, unknown> }>(
  c: Context<ApiEnv>,
  schema: S,
): Promise<{ ok: true; value: ParsedOf<S> } | { ok: false; response: Response }> => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: sendProblem(c, "request.malformed", { detail: "The body is not valid JSON." }) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields = fieldsFrom(parsed.error);
    return {
      ok: false,
      response: sendProblem(c, "request.validation_failed", { detail: validationDetail(fields), fields }),
    };
  }
  return { ok: true, value: parsed.data as ParsedOf<S> };
};
