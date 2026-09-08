import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Only catalog-owned names are passed here by the server pages. */
export async function exampleSource(name: string, aggregate = false) {
  return readFile(
    join(
      process.cwd(),
      "src/app/design",
      aggregate ? "aggregates/examples" : "examples",
      `${name}.tsx`,
    ),
    "utf8",
  );
}
