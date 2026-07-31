/**
 * Logging, and what must never appear in it.
 *
 * The redaction tests are the load-bearing ones. A credential in a log line is
 * a credential in Railway's log viewer, in whatever ships logs onward, and in
 * any screenshot of either.
 */

import { describe, expect, test } from "bun:test";
import { createLogger, redact } from "./log";

const capture = () => {
  const lines: string[] = [];
  const logger = createLogger({ service: "api", sink: (l) => lines.push(l), now: () => 1_700_000_000_000, minLevel: "debug" });
  return { lines, logger, parsed: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
};

describe("a log line is one JSON object with the fields that make it searchable", () => {
  test("level, event, timestamp and service, always", () => {
    const { logger, parsed } = capture();
    logger.info("http.request", { status: 200 });
    expect(parsed()[0]).toMatchObject({
      level: "info",
      event: "http.request",
      ts: "2023-11-14T22:13:20.000Z",
      service: "api",
      status: 200,
    });
  });

  test("`service` distinguishes the three deployables in one log view", () => {
    // api, web and worker land in the same place. Without this field the
    // unified view is unreadable.
    const lines: string[] = [];
    createLogger({ service: "worker", sink: (l) => lines.push(l) }).info("job.run");
    expect((JSON.parse(lines[0]!) as { service: string }).service).toBe("worker");
  });

  test("bound fields ride along on every line, so no handler has to remember", () => {
    const { logger, parsed } = capture();
    const bound = logger.with({ requestId: "req_1", traceId: "t1" });
    bound.info("a");
    bound.warn("b");
    for (const line of parsed()) expect(line).toMatchObject({ requestId: "req_1", traceId: "t1" });
  });

  test("binding is additive, not destructive", () => {
    const { logger, parsed } = capture();
    logger.with({ requestId: "req_1" }).with({ projectId: "prj_1" }).info("a");
    expect(parsed()[0]).toMatchObject({ requestId: "req_1", projectId: "prj_1" });
  });

  test("below the floor is not emitted", () => {
    const lines: string[] = [];
    const logger = createLogger({ service: "api", sink: (l) => lines.push(l), minLevel: "warn" });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(lines).toHaveLength(2);
  });

  test("an unserialisable field loses the detail, not the line", () => {
    // A circular reference in something a handler logged must not take down
    // the request it was describing.
    const { logger, parsed } = capture();
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    logger.error("boom", { circular });
    expect(parsed()[0]).toMatchObject({ event: "boom", unserializable: true });
  });
});

describe("credentials never reach the output", () => {
  test("a secret key is replaced wherever it appears", () => {
    const { logger, lines } = capture();
    logger.error("db.error", { detail: "insert failed for key sk_kP3nR7xQ9wLmZaB4cD6eF8gH0jK2lM4n" });
    expect(lines[0]).not.toContain("sk_kP3nR7xQ9wLmZaB4cD6eF8gH0jK2lM4n");
    expect(lines[0]).toContain("redacted");
  });

  test("every credential prefix we mint is covered", () => {
    for (const prefix of ["ck", "sk", "st", "ct", "svc"]) {
      const secret = `${prefix}_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345`;
      expect(redact(`presented ${secret}`)).not.toContain(secret);
    }
  });

  test("a bearer token is redacted even when it is not one of ours", () => {
    // Somebody else's token in a proxied error is still a token.
    const line = redact("upstream said: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def");
    expect(line).not.toContain("eyJhbGciOiJIUzI1NiJ9.abc.def");
  });

  test("redaction applies to the serialized line, not to fields somebody sanitised", () => {
    // The case a field-by-field approach misses: a key inside a message
    // nobody expected to contain one.
    const { logger, lines } = capture();
    logger.error("http.unhandled", {
      error: 'duplicate key value violates unique constraint "credentials_digest_key" for sk_ZZZaBcDeFgHiJkLmNoPqRsTuVwXyZ01',
    });
    expect(lines[0]).not.toContain("sk_ZZZaBcDeFgHiJkLmNoPqRsTuVwXyZ01");
  });

  test("enough of the prefix survives to correlate two lines about the same key", () => {
    // Which is most of why anyone wanted the key in the log.
    const redacted = redact("key sk_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345");
    expect(redacted).toContain("sk_aBc");
    expect(redacted).toContain("[redacted:35]");
  });

  test("short strings that merely start with a prefix are left alone", () => {
    // `sk_` in prose, or a truncated display stub, is not a secret. Redacting
    // it would make real log lines harder to read for no gain.
    expect(redact("the sk_ prefix means service")).toContain("sk_ prefix");
  });

  test("a line with no secret is passed through byte for byte", () => {
    const line = JSON.stringify({ level: "info", event: "http.request", status: 200 });
    expect(redact(line)).toBe(line);
  });
});
