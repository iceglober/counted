import { expect, test } from "bun:test";
import { apiOrigin, ingestOrigin } from "./env";

test("SDK examples use the public API while server calls keep the private connection", () => {
  const env = { NODE_ENV: "test" as const, COUNTED_API_URL: "http://api.internal:8080/", COUNTED_PUBLIC_API_URL: "https://events.example.test/" };
  expect(apiOrigin(env)).toBe("http://api.internal:8080");
  expect(ingestOrigin(env)).toBe("https://events.example.test");
  expect(ingestOrigin({ NODE_ENV: "test", COUNTED_API_URL: "http://localhost:8080/" })).toBe("http://localhost:8080");
});
