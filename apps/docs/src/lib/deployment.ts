import { apiDocument } from "@counted/openapi";

type Environment = Readonly<Record<string, string | undefined>>;

function publicOrigin(value: string | undefined, fallback: string): string {
  const url = new URL(value ?? fallback);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Documentation destinations must be public HTTP(S) origins without credentials.");
  }
  return url.origin;
}

/** Read when handling a request; a built image can serve any installation. */
export function publicUrls(env: Environment = process.env) {
  return {
    docs: publicOrigin(env.COUNTED_DOCS_URL, "https://docs.counted.dev"),
    console: publicOrigin(env.COUNTED_CONSOLE_URL, "https://app.counted.dev"),
    api: publicOrigin(env.COUNTED_PUBLIC_API_URL, "https://api.counted.dev"),
  };
}

/** Operations stay generated; only the deployment's public server changes. */
export function deploymentDocument(env: Environment = process.env) {
  return { ...apiDocument, servers: [{ url: publicUrls(env).api }] };
}
