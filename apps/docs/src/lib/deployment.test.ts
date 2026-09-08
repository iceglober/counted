import { describe, expect, test } from "bun:test";
import { apiDocument } from "@counted/openapi";
import { deploymentDocument, publicUrls } from "./deployment";

describe("documentation deployment destinations", () => {
  test("an unconfigured installation keeps hosted defaults", () => {
    expect(publicUrls({})).toEqual({ docs: "https://docs.counted.dev", console: "https://app.counted.dev", api: "https://api.counted.dev" });
  });

  test("reads public origins at call time and never uses the private API upstream", () => {
    const env = {
      COUNTED_DOCS_URL: "https://reference.example.test/",
      COUNTED_CONSOLE_URL: "https://console.example.test/",
      COUNTED_PUBLIC_API_URL: "https://events.example.test/",
      COUNTED_API_URL: "http://private-upstream:8080",
    };
    expect(publicUrls(env)).toEqual({ docs: "https://reference.example.test", console: "https://console.example.test", api: "https://events.example.test" });
    env.COUNTED_DOCS_URL = "http://localhost:3001";
    expect(publicUrls(env).docs).toBe("http://localhost:3001");
    expect(publicUrls({ COUNTED_API_URL: env.COUNTED_API_URL }).api).toBe("https://api.counted.dev");
  });

  test("refuses non-HTTP destinations and embedded credentials", () => {
    for (const value of ["javascript:alert(1)", "file:///tmp/docs", "https://user:password@example.test", "invalid"]) {
      expect(() => publicUrls({ COUNTED_DOCS_URL: value })).toThrow();
    }
  });

  test("only the public server is specialized; generated ingestion and management schemas stay intact", () => {
    const configured = deploymentDocument({ COUNTED_PUBLIC_API_URL: "http://localhost:8080" });
    expect(configured.servers).toEqual([{ url: "http://localhost:8080" }]);
    expect(configured.paths).toBe(apiDocument.paths);
    expect(configured.components).toBe(apiDocument.components);
    expect(configured.paths["/v1/events"]?.post).toBeDefined();
    expect(configured.paths["/v1/me"]?.get).toBeDefined();
    expect(apiDocument.servers).toEqual([{ url: "https://api.counted.dev" }]);
  });
});
