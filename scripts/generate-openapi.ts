/**
 * Writes the OpenAPI artifact.
 *
 * CI runs this and fails if the working tree changes, so the committed
 * document can never describe an API the code does not implement.
 */
import { buildOpenApiDocument } from "../packages/contracts/src/openapi";

const target = new URL("../openapi.json", import.meta.url).pathname;
const document = JSON.stringify(buildOpenApiDocument(), null, 2) + "\n";
await Bun.write(target, document);
console.log(`wrote ${target} (${document.length} bytes)`);
