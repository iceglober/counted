/**
 * Configuration is read once, at startup, and a deployment with a hole in it
 * fails to start.
 *
 * v1 read `process.env.STRIPE_WEBHOOK_SECRET` inside the webhook handler, so a
 * missing secret was discovered by the first customer to pay, at 02:00, as a
 * 500. Every problem below is found before the process takes traffic, and all
 * of them are reported at once — an operator fixing one variable per deploy is
 * an operator doing five deploys.
 */

import { describe, expect, test } from "bun:test";
import { isErr, isOk } from "@counted/kernel";
import { loadConfig, type Environment } from "./config";

const complete: Environment = {
  COUNTED_API_URL: "https://api.counted.dev",
  COUNTED_CONSOLE_URL: "https://counted.dev",
  DATABASE_URL: "postgres://localhost/counted",
  COUNTED_AUTH_SECRET: "secret",
  COUNTED_UNCLAIMED_WORKSPACE_ID: "ws_holding",
  COUNTED_UNCLAIMED_WORKSPACE_OWNER_ID: "acct_operator",
};

describe("loading configuration", () => {
  test("a complete environment loads", () => {
    const loaded = loadConfig(complete);
    expect(isOk(loaded)).toBe(true);
  });

  test("every missing variable is reported, not just the first", () => {
    const loaded = loadConfig({});
    expect(isErr(loaded)).toBe(true);
    if (!isErr(loaded)) return;
    expect(loaded.error.map((problem) => problem.variable).sort()).toEqual([
      "COUNTED_API_URL",
      "COUNTED_AUTH_SECRET",
      "COUNTED_CONSOLE_URL",
      "COUNTED_UNCLAIMED_WORKSPACE_ID",
      "COUNTED_UNCLAIMED_WORKSPACE_OWNER_ID",
      "DATABASE_URL",
    ]);
  });

  /**
   * A trailing slash produces `//api/auth`, which better-auth's own origin
   * check treats as a different origin and refuses — so sign-in appears to work
   * and then has no session.
   */
  test("a base URL is normalised without its trailing slash", () => {
    const loaded = loadConfig({ ...complete, COUNTED_API_URL: "https://api.counted.dev/" });
    expect(isOk(loaded)).toBe(true);
    if (!isOk(loaded)) return;
    expect(loaded.value.baseUrl).toBe("https://api.counted.dev");
  });

  /**
   * Stripe with a secret key and no webhook secret is worse than Stripe absent:
   * checkout works, the webhook that grants the plan does not, and the customer
   * has paid for nothing. That is v1's failure exactly.
   */
  test("a half-configured payment provider is refused, not half-enabled", () => {
    const loaded = loadConfig({ ...complete, STRIPE_SECRET_KEY: "sk_test" });
    expect(isErr(loaded)).toBe(true);
    if (!isErr(loaded)) return;
    expect(loaded.error[0]?.variable).toBe("STRIPE_*");
    expect(loaded.error[0]?.detail).toContain("STRIPE_WEBHOOK_SECRET");
  });

  test("no payment provider at all is a valid deployment", () => {
    const loaded = loadConfig(complete);
    expect(isOk(loaded) && loaded.value.stripe).toBeNull();
  });

  test("a fully configured payment provider loads its prices", () => {
    const loaded = loadConfig({
      ...complete,
      STRIPE_SECRET_KEY: "sk_test",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      STRIPE_PRICE_PRO_MONTHLY: "price_m",
      STRIPE_PRICE_PRO_ANNUAL: "price_a",
    });
    expect(isOk(loaded)).toBe(true);
    if (!isOk(loaded)) return;
    expect(loaded.value.stripe?.prices.pro).toEqual({ monthly: "price_m", annual: "price_a" });
  });

  /**
   * A client id with no secret is a sign-in button that fails after the
   * redirect, which is worse than no button. Same rule as Stripe, same reason.
   */
  test("a half-configured social provider is refused, not half-enabled", () => {
    const loaded = loadConfig({ ...complete, GITHUB_CLIENT_ID: "iv1.abc" });
    expect(isErr(loaded)).toBe(true);
    if (!isErr(loaded)) return;
    expect(loaded.error[0]?.variable).toBe("GITHUB_*");
    expect(loaded.error[0]?.detail).toContain("GITHUB_CLIENT_SECRET");
  });

  test("each social provider is configured on its own", () => {
    const loaded = loadConfig({ ...complete, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" });
    expect(isOk(loaded)).toBe(true);
    if (!isOk(loaded)) return;
    expect(loaded.value.social).toEqual({
      github: null,
      google: { clientId: "id", clientSecret: "secret" },
    });
  });

  test("no social provider at all is a valid deployment", () => {
    const loaded = loadConfig(complete);
    expect(isOk(loaded) && loaded.value.social).toEqual({ github: null, google: null });
  });

  test("a non-numeric port is a named problem, not a silent NaN", () => {
    const loaded = loadConfig({ ...complete, PORT: "eighty" });
    expect(isErr(loaded)).toBe(true);
    if (!isErr(loaded)) return;
    expect(loaded.error.some((problem) => problem.variable === "PORT")).toBe(true);
  });

  test("an unknown log level is refused rather than defaulted", () => {
    const loaded = loadConfig({ ...complete, LOG_LEVEL: "verbose" });
    expect(isErr(loaded)).toBe(true);
  });

  /**
   * The deploy workflow sets `RELEASE` to the commit it deployed; a service
   * Railway builds from GitHub itself gets `RAILWAY_GIT_COMMIT_SHA` instead.
   * Neither is required — a local run has no release — so this is the one
   * variable that is never a problem, only present or not.
   */
  test("the release is RELEASE, else Railway's commit sha, else empty", () => {
    const releaseOf = (env: Environment) => {
      const loaded = loadConfig({ ...complete, ...env });
      return isOk(loaded) ? loaded.value.release : loaded.error;
    };
    expect(releaseOf({})).toBe("");
    expect(releaseOf({ RAILWAY_GIT_COMMIT_SHA: "abc123" })).toBe("abc123");
    expect(releaseOf({ RELEASE: "def456", RAILWAY_GIT_COMMIT_SHA: "abc123" })).toBe("def456");
    expect(releaseOf({ RELEASE: "  ", RAILWAY_GIT_COMMIT_SHA: "abc123" })).toBe("abc123");
  });
});
