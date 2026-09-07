/** Only disposable databases on a local PostgreSQL server can run this suite. */
export function browserSettings() {
  const database = process.env.COUNTED_BROWSER_DATABASE_URL;
  if (!database) throw new Error("Set COUNTED_BROWSER_DATABASE_URL to a local PostgreSQL database with CREATE DATABASE permission.");
  const admin = new URL(database);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(admin.hostname)) throw new Error("Browser tests require a local PostgreSQL server.");
  const runId = process.env.COUNTED_BROWSER_RUN_ID;
  if (!runId || !/^[a-z0-9_]+$/.test(runId)) throw new Error("Run browser tests through playwright.config.ts.");
  const databaseName = `counted_browser_${runId}`;
  const isolated = new URL(admin);
  isolated.pathname = `/${databaseName}`;
  return {
    adminUrl: admin.toString(), databaseUrl: isolated.toString(), databaseName,
    webPort: 3300, apiPort: 8891, stripePort: 12112,
    webUrl: "http://127.0.0.1:3300", apiUrl: "http://127.0.0.1:8891", stripeUrl: "http://127.0.0.1:12112",
    distDir: process.env.COUNTED_NEXT_DIST_DIR ?? ".next",
  };
}
