/** Shell quoting keeps a pasted key or configured URL inside its one argument. */
const shell = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export function setupExample(
  language: string,
  endpoint: string,
  key: string
): string {
  const origin = endpoint.replace(/\/+$/, "");
  if (language !== "http") {
    const options = `key: ${JSON.stringify(key)}${
      origin === "https://api.counted.dev"
        ? ""
        : `, endpoint: ${JSON.stringify(origin + "/v1/events")}`
    }`;
    return `import { Counted } from "@counted/sdk";\n\nconst counted = new Counted({ ${options} });\ncounted.track("page_view", { path: "/welcome" });${
      language === "node"
        ? "\n\n// Before this process exits:\nawait counted.shutdown();"
        : ""
    }`;
  }
  return `COUNTED_VISIT_ID=$(uuidgen)\ncurl ${shell(
    origin + "/v1/events"
  )} \\\n  -H ${shell(
    "authorization: Bearer " + key
  )} \\\n  -H 'content-type: application/json' \\\n  -d '{"events":[{"name":"page_view","visitId":"'"$COUNTED_VISIT_ID"'","properties":{"path":"/welcome"}}]}'`;
}
