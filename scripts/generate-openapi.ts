#!/usr/bin/env bun
/**
 * Writes the OpenAPI artifact from the contract.
 *
 * CI runs `openapi:check`, which regenerates and fails if the working tree
 * changes — so the committed document can never describe an API the code does
 * not implement. That property is the whole point: v2 had a second,
 * hand-written description of every route (648 lines of it) that was free to
 * drift, and did.
 *
 * Everything in the document that is not a procedure — the info block, the tag
 * list, the security schemes — comes out of `@counted/contract` rather than
 * being written here. This script is a consumer of the contract, not a second
 * author of it. A security scheme defined here and referenced by a `security`
 * block emitted there would be two files that have to agree.
 *
 * Three facts about `@orpc/openapi@2.0.0-beta.32`, read out of the installed
 * .d.ts rather than remembered, because two of them differ from what the
 * migration notes say:
 *
 *   - the constructor option is `converters`, NOT `schemaConverters`
 *   - document metadata goes under `base`, NOT a top-level `info`
 *   - `ZodToJsonSchemaConverter` is a ROOT export of `@orpc/zod`; there is no
 *     `@orpc/zod/zod4` subpath in v2
 *
 * The generator emits OpenAPI **3.1.2**. There is no 3.0 output, so a
 * downstream tool that only reads 3.0 needs converting, not configuring.
 */

import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import {
  API_INFO,
  API_TAGS,
  SECURITY_SCHEME_DEFINITIONS,
  INGESTION_PATHS,
  INGESTION_SCHEMAS,
  contract,
} from "../packages/contract/src/index";

const generator = new OpenAPIGenerator({
  converters: [new ZodToJsonSchemaConverter()],
});

const document = await generator.generate(contract, {
  base: {
    info: API_INFO,
    servers: [{ url: "https://api.counted.dev" }],
    tags: [...API_TAGS],
    paths: INGESTION_PATHS,
    components: { securitySchemes: { ...SECURITY_SCHEME_DEFINITIONS }, schemas: INGESTION_SCHEMAS },
  },
});

const target = new URL("../openapi.json", import.meta.url).pathname;
const json = JSON.stringify(document, null, 2) + "\n";
await Bun.write(target, json);
console.log(`wrote ${target} (${json.length} bytes)`);
