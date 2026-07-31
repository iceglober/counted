/**
 * The API's own document, not a description of it.
 *
 * v1 shipped a hand-written 1020-line spec here. It drifted — twelve
 * documented-vs-actual mismatches, and it omitted `/provision` entirely, the
 * one endpoint its own agent cards advertised as the entry point. Replacing it
 * with a generated artifact is one of the things the rewrite exists to do, and
 * copying the hand-written one across would have undone that silently.
 *
 * `buildOpenApiDocument()` is the same call the committed `openapi.json` is
 * generated from, and CI fails on any difference between them. So the docs
 * page cannot describe an API the server does not implement.
 */

import { buildOpenApiDocument } from "@counted/contracts";

export const spec = buildOpenApiDocument() as {
  readonly paths: Record<string, Record<string, { summary?: string; description?: string; tags?: string[]; deprecated?: boolean }>>;
  readonly tags?: { name: string; description?: string }[];
  readonly info: { title: string; version: string; description?: string };
};
