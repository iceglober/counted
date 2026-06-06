import { spec } from "../lib/openapi";
import { mkdirSync, writeFileSync } from "fs";

// Bridge: dump the canonical OpenAPI spec (lib/openapi.ts) to the file Fern reads
// (fern/generators.yml -> api.path). Run before `fern generate`. The committed
// JSON is also what the CI freshness check compares against.
const outDir = new URL("openapi/", import.meta.url);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL("openapi.json", outDir), JSON.stringify(spec, null, 2) + "\n");

console.log("Exported OpenAPI spec to fern/openapi/openapi.json");
