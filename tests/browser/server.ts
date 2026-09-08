import { Pool } from "pg";
import { resolve } from "node:path";
import { browserSettings } from "./settings";

const settings = browserSettings();
const root = resolve(import.meta.dir, "../..");
const admin = new Pool({ connectionString: settings.adminUrl });
const children: ReturnType<typeof Bun.spawn>[] = [];
let stopping = false;
let created = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(children.map(child => Promise.race([child.exited, Bun.sleep(5000)])));
  for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
  if (created) await admin.query(`DROP DATABASE "${settings.databaseName}" WITH (FORCE)`);
  await admin.end();
  process.exit(code);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());

// Do not inherit provider credentials or dotenv from the developer's shell.
// Only the API receives database/auth configuration. The console gets URLs.
const runtime = {
  PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "/tmp",
  NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production",
};
const urls = { COUNTED_API_URL: settings.apiUrl, COUNTED_CONSOLE_URL: settings.webUrl };
function start(name: string, cmd: string[], env: Record<string, string>, cwd = root) {
  const child = Bun.spawn(cmd, { cwd, env: { ...runtime, ...env }, stdout: "inherit", stderr: "inherit" });
  children.push(child);
  void child.exited.then(code => {
    if (!stopping) { console.error(`${name} exited unexpectedly (${code})`); void stop(code || 1); }
  });
}
async function ready(url: string) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch { /* Starting. */ }
    await Bun.sleep(250);
  }
  throw new Error(`Test service did not become ready: ${url}`);
}

try {
  await admin.query(`CREATE DATABASE "${settings.databaseName}"`);
  created = true;
  start("Stripe stand-in", [process.execPath, "--no-env-file", "scripts/dev-stripe.ts"], {
    ...urls, COUNTED_DEV_STRIPE_PORT: String(settings.stripePort), STRIPE_WEBHOOK_SECRET: "whsec_browser_test",
    STRIPE_PRICE_PRO_MONTHLY: "price_browser_monthly", STRIPE_PRICE_PRO_ANNUAL: "price_browser_annual",
  });
  await ready(`${settings.stripeUrl}/health`);
  start("API", [process.execPath, "--no-env-file", "apps/api/src/main.ts"], {
    ...urls, PORT: String(settings.apiPort), DATABASE_URL: settings.databaseUrl,
    COUNTED_AUTH_SECRET: "browser-tests-only-not-a-production-secret-2026",
    COUNTED_UNCLAIMED_WORKSPACE_ID: "browser_holding", COUNTED_UNCLAIMED_WORKSPACE_OWNER_ID: "browser_system",
    STRIPE_API_BASE: settings.stripeUrl, STRIPE_SECRET_KEY: "sk_test_browser_standin",
    STRIPE_WEBHOOK_SECRET: "whsec_browser_test", STRIPE_PRICE_PRO_MONTHLY: "price_browser_monthly", STRIPE_PRICE_PRO_ANNUAL: "price_browser_annual",
    LOG_LEVEL: "warn",
  });
  await ready(`${settings.apiUrl}/health`);
  start("Console", [process.execPath, "--no-env-file", resolve(root, "node_modules/next/dist/bin/next"), "start", "--port", String(settings.webPort), "--hostname", "127.0.0.1"], {
    ...urls, COUNTED_NEXT_DIST_DIR: settings.distDir,
  }, resolve(root, "apps/web"));
} catch (error) {
  console.error(error);
  await stop(1);
}
