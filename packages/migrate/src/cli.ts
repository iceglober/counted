import { parseArgs } from "node:util";
import { migrateAptabase } from "./aptabase";

const { values } = parseArgs({
  options: {
    "source-db": { type: "string" },
    "source-csv": { type: "string" },
    "target-key": { type: "string" },
    "target-host": { type: "string", default: "https://counted.dev" },
    since: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "batch-size": { type: "string", default: "50" },
    concurrency: { type: "string", default: "4" },
  },
  strict: true,
});

const targetKey = values["target-key"];
if (!targetKey) {
  console.error("--target-key is required");
  process.exit(1);
}

if (!values["source-db"] && !values["source-csv"]) {
  console.error("Either --source-db or --source-csv is required");
  process.exit(1);
}

migrateAptabase({
  sourceDb: values["source-db"],
  sourceCsv: values["source-csv"],
  targetKey,
  targetHost: values["target-host"]!,
  since: values.since,
  dryRun: values["dry-run"]!,
  batchSize: parseInt(values["batch-size"]!, 10),
  concurrency: parseInt(values.concurrency!, 10),
}).catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
