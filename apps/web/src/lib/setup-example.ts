/** Shell quoting keeps a pasted key or configured URL inside its one argument. */
const shell = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export function setupExample(language: string, endpoint: string, key: string): string {
  if (language === "js") return `import { Counted } from "@counted/sdk";\n\nconst counted = new Counted({\n  key: ${JSON.stringify(key)},\n  endpoint: ${JSON.stringify(endpoint + "/v1/events")},\n});\ncounted.track("page_view", { path: "/welcome" });\nawait counted.flush();`;
  return `curl ${shell(endpoint + "/v1/events")} \\\n  -H ${shell("authorization: Bearer " + key)} \\\n  -H 'content-type: application/json' \\\n  -d '{"events":[{"name":"page_view","visitId":"setup-visit","properties":{"path":"/welcome"}}]}'`;
}
