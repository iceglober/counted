/**
 * Configuration refuses to guess.
 *
 * Two of these variables are security questions rather than convenience ones: a
 * defaulted resource identifier would make this server advertise itself as
 * something it is not, and a defaulted API URL would send the caller's token
 * somewhere nobody chose. Both are required, and the failure names what the
 * variable is for rather than just its name.
 */

import { describe, expect, test } from "bun:test";
import { describeConfigFailure, readConfig } from "./config";

const complete = {
  COUNTED_API_URL: "https://api.counted.dev",
  COUNTED_MCP_RESOURCE: "https://mcp.counted.dev/mcp",
  COUNTED_OAUTH_ISSUER: "https://api.counted.dev/api/auth",
};

describe("reading configuration", () => {
  test("a complete environment produces a usable config", () => {
    const result = readConfig(complete);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.apiUrl).toBe("https://api.counted.dev");
    expect(result.value.identity.resource).toBe("https://mcp.counted.dev/mcp");
    expect(result.value.identity.issuer).toBe("https://api.counted.dev/api/auth");
    expect(result.value.port).toBe(3002);
  });

  test("the endpoint path is taken from the resource identifier, not declared twice", () => {
    // RFC 9728 ties the well-known path to the resource's path. Letting the
    // listening path be configured separately would let the two disagree, and a
    // client would look for metadata where nothing is served.
    const result = readConfig({ ...complete, COUNTED_MCP_RESOURCE: "https://mcp.counted.dev/agent/mcp" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.endpoint).toBe("/agent/mcp");
  });

  test("a missing variable is named along with what it is for", () => {
    for (const variable of Object.keys(complete)) {
      const env: Record<string, string | undefined> = { ...complete };
      delete env[variable];
      const result = readConfig(env);
      expect(result.ok, variable).toBe(false);
      if (result.ok) continue;
      expect(result.error.kind).toBe("Missing");
      expect(describeConfigFailure(result.error)).toContain(variable);
      expect(describeConfigFailure(result.error).length).toBeGreaterThan(variable.length + 20);
    }
  });

  test("a value that is not a URL is refused rather than concatenated into one", () => {
    const result = readConfig({ ...complete, COUNTED_API_URL: "api.counted.dev" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotAUrl");
  });

  test("a port that is not a positive integer is refused", () => {
    for (const value of ["0", "-1", "eight", "1.5"]) {
      expect(readConfig({ ...complete, PORT: value }).ok, value).toBe(false);
    }
  });

  test("a trailing slash on the API URL does not become a double slash in a route", () => {
    const result = readConfig({ ...complete, COUNTED_API_URL: "https://api.counted.dev/" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.apiUrl).toBe("https://api.counted.dev");
  });
});
