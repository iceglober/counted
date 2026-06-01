import { spec } from "../lib/openapi";
import { writeFileSync } from "fs";

writeFileSync(
  new URL("openapi/openapi.json", import.meta.url),
  JSON.stringify(spec, null, 2),
);

console.log("Exported OpenAPI spec to fern/openapi/openapi.json");
