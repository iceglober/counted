/**
 * The translation, and the boundary it enforces.
 *
 * Two kinds of test. The first is ordinary: their envelope in, our events out.
 * The second is the reason this is a separate package — **their vocabulary
 * must not exist anywhere else in the repo.** That is a property of the source
 * tree, and it decays the moment somebody finds it convenient to read
 * `systemProps` one layer deeper.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gone, looksLikeAptabaseKey, presentedKey, translate } from "./index";

const ROOT = join(import.meta.dir, "../../..");

const event = (over: Record<string, unknown> = {}) => ({
  eventName: "app_started",
  sessionId: "s-1",
  timestamp: "2026-05-01T10:00:00.000Z",
  systemProps: { osName: "iOS", osVersion: "17.4", locale: "en-GB", appVersion: "1.2.0", sdkVersion: "aptabase-swift/0.4" },
  props: { screen: "home" },
  ...over,
});

const first = (body: unknown) => {
  const result = translate(body);
  if (!result.ok) throw new Error(`expected a translation, got: ${result.reason}`);
  return result.events[0]!;
};

describe("their envelope becomes ours", () => {
  test("the field names are renamed, one for one", () => {
    expect(first(event())).toMatchObject({
      name: "app_started",
      // Their session id is our visit id. Both are ephemeral activity
      // groupings; neither is an identity, and Counted will not treat it as
      // one. v1's schema called it `session_id` and counted distinct values
      // of it as "users".
      visitId: "s-1",
      occurredAt: "2026-05-01T10:00:00.000Z",
      properties: { screen: "home" },
      systemProperties: { os_name: "iOS", os_version: "17.4", locale: "en-GB" },
    });
  });

  test("epoch millis are accepted as well as ISO", () => {
    // Their SDKs disagree about which they send.
    expect(first(event({ timestamp: 1777629600000 })).occurredAt).toBe("2026-05-01T10:00:00.000Z");
  });

  test("an unparseable timestamp is left absent, not invented", () => {
    // Absent means the server stamps arrival and warns. Guessing a value would
    // put a fabricated instant in the dedup key.
    expect(first(event({ timestamp: "yesterday" })).occurredAt).toBeUndefined();
  });

  test("a batch and a single event are both accepted, on either path", () => {
    // Their own SDKs are not consistent about it, and refusing would break a
    // client that works against Aptabase itself.
    expect(translate(event())).toMatchObject({ ok: true });
    expect(translate([event(), event()])).toMatchObject({ ok: true });
  });

  test("fields we have no column for become properties rather than vanishing", () => {
    // Silently dropping something somebody is already sending is the worse
    // failure: they see the event arrive and the field simply not be there.
    const translated = first(event({ systemProps: { isDebug: true, appBuildNumber: 42 } }));
    expect(translated.properties).toMatchObject({ aptabase_is_debug: true, aptabase_app_build_number: 42 });
  });

  test("a null system property is kept, because null is an answer", () => {
    // "The SDK looked and there was nothing" is different from "the SDK did
    // not look", and the platform reader downstream distinguishes them.
    expect(first(event({ systemProps: { osName: null } })).systemProperties).toMatchObject({ os_name: null });
  });

  test("a nested property is dropped rather than stringified", () => {
    // A value that arrives as "[object Object]" is worse than one that is
    // missing, because it looks like data.
    const translated = first(event({ props: { ok: "yes", nested: { a: 1 } } }));
    expect(translated.properties).toEqual({ ok: "yes" });
  });
});

describe("what it refuses", () => {
  test("a missing eventName or sessionId", () => {
    expect(translate(event({ eventName: undefined }))).toMatchObject({ ok: false });
    expect(translate(event({ sessionId: undefined }))).toMatchObject({ ok: false });
  });

  test("an empty batch, and one that is too large", () => {
    expect(translate([])).toMatchObject({ ok: false });
    expect(translate(Array.from({ length: 251 }, () => event()))).toMatchObject({ ok: false });
  });

  test("one bad event refuses the whole batch", () => {
    // Their SDK retries the batch it sent. Partially accepting would
    // double-count everything that succeeded on the retry.
    expect(translate([event(), event({ eventName: undefined })])).toMatchObject({ ok: false });
  });

  test("it never throws, whatever it is given", () => {
    for (const nonsense of [null, undefined, 42, "text", [[]], { events: {} }]) {
      expect(() => translate(nonsense)).not.toThrow();
    }
  });
});

describe("where the key comes from", () => {
  const url = new URL("https://api.counted.dev/api/v0/event?key=ck_from_query");

  test("App-Key first, then Project-Key, then the query string", () => {
    // Their SDKs send App-Key; Counted's v1 sent Project-Key; a customer
    // part-way through a migration has both in the field at once.
    expect(presentedKey(new Headers({ "app-key": "A-US-1234567890" }), url)?.source).toBe("app-key");
    expect(presentedKey(new Headers({ "project-key": "ck_x" }), url)?.source).toBe("project-key");
    expect(presentedKey(new Headers(), url)?.key).toBe("ck_from_query");
  });

  test("App-Key wins when both are sent", () => {
    const headers = new Headers({ "app-key": "A-US-1234567890", "project-key": "ck_x" });
    expect(presentedKey(headers, url)?.source).toBe("app-key");
  });

  test("no key at all is null, not an empty string", () => {
    expect(presentedKey(new Headers(), new URL("https://api.counted.dev/api/v0/event"))).toBeNull();
  });

  test("an Aptabase key is recognised by shape, so the refusal can say so", () => {
    // We have never issued one and never could. "Invalid key" would send
    // somebody looking for a typo.
    expect(looksLikeAptabaseKey("A-US-1234567890")).toBe(true);
    expect(looksLikeAptabaseKey("A-EU-9876543210")).toBe(true);
    expect(looksLikeAptabaseKey("ck_live_abcdef")).toBe(false);
  });
});

describe("removed endpoints announce themselves", () => {
  test("410 with a Link to the successor, not 404", () => {
    // These existed. "Gone" and "wrong URL" send somebody to different places.
    const response = gone("/api/v0/query");
    expect(response.status).toBe(410);
    expect(response.headers["link"]).toBe('</v1/openapi.json>; rel="successor-version"');
  });
});

describe("their vocabulary stops at this package", () => {
  /**
   * The reason this is a separate package rather than a function in the API.
   * v1 put Aptabase's field names in its database columns, so a rename in
   * their SDK would have been a migration in ours.
   *
   * Checked against the tree, because it decays by convenience: one
   * `systemProps` read a layer deeper and the boundary is gone, with
   * everything still building.
   */
  /**
   * Words that are unambiguously theirs, matched on word boundaries.
   *
   * Two rounds of tightening, both because an over-broad check is worse than
   * none — a test that cries wolf gets deleted:
   *
   * - Substring matching flagged `eventNames` in the funnel domain and the
   *   schema catalog. That is our own phrase for "the names of events".
   * - `sessionId` flagged five agent packages, where it means an agent host's
   *   session. It is a generic word and is not on this list; `systemProps` and
   *   `appBuildNumber` are theirs and nobody else's, which is what makes them
   *   worth watching.
   */
  const THEIR_WORDS = ["systemProps", "eventName", "appBuildNumber", "isDebug"];
  const mentions = (source: string, word: string): boolean =>
    new RegExp(`\\b${word}\\b`).test(source);

  const sourcesUnder = (relative: string): readonly string[] => {
    const found: string[] = [];
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".next") continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name)) found.push(path);
      }
    };
    walk(join(ROOT, relative));
    return found;
  };

  test("the domain, ports and adapters never mention it", () => {
    const offenders: { file: string; word: string }[] = [];
    for (const area of ["packages/domain", "packages/ports", "packages/application", "packages/adapters"]) {
      for (const file of sourcesUnder(area)) {
        const source = readFileSync(file, "utf8");
        for (const word of THEIR_WORDS) {
          if (mentions(source, word)) offenders.push({ file: file.slice(ROOT.length + 1), word });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("only the compat package and the one route that mounts it know the words", () => {
    const knowing = sourcesUnder("packages")
      .concat(sourcesUnder("apps"))
      .filter((file) => THEIR_WORDS.some((word) => mentions(readFileSync(file, "utf8"), word)))
      .map((file) => file.slice(ROOT.length + 1))
      // The v1 SDK still ships Aptabase compat of its own and is not part of
      // the v2 tree; it goes at cutover.
      // v1 packages, which go at cutover and are not part of the v2 tree.
      .filter((file) => !/^packages\/(sdk|react|api)\//.test(file))
      // The migration tool reads Aptabase's *export* format, which is its
      // entire purpose. It is the second legitimate boundary, and it is
      // equally sealed: nothing downstream of it speaks their vocabulary.
      // The whole package, because its tests assert the words are *absent*
      // from what it sends — and a check that flagged that assertion would be
      // punishing the thing it wants.
      .filter((file) => !file.startsWith("packages/migrate/"))
      // The OpenAPI document *describes* this endpoint, which means naming the
      // fields it accepts. Describing a foreign shape is not adopting it — and
      // an endpoint documented without saying what it takes would be worse.
      .filter((file) => file !== "packages/contracts/src/openapi.ts");

    for (const file of knowing) {
      expect({ file }).toMatchObject({
        file: expect.stringMatching(/^(packages\/aptabase-compat\/|apps\/api\/src\/routes\/compat)/),
      });
    }
  });

  test("the check is not vacuous — this package does use the words", () => {
    const source = readFileSync(join(ROOT, "packages/aptabase-compat/src/translate.ts"), "utf8");
    for (const word of THEIR_WORDS) expect(source).toContain(word);
  });
});
