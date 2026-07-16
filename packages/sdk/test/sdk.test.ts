import { test, expect, mock, beforeEach, afterEach, setSystemTime } from "bun:test";
import { Analytics } from "../src/analytics";
import { Session } from "../src/session";
import { detectSystemProps } from "../src/system-props";
import { init, trackEvent } from "../src/aptabase";

const tick = () => new Promise((r) => setTimeout(r, 5));

type FetchCall = { url: string; init: RequestInit };

function mockFetch(handler?: (url: string, init: RequestInit) => Response): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = mock(async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return handler ? handler(String(url), (init ?? {}) as RequestInit) : new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;
  return calls;
}

// Preserve and restore globals we tamper with.
let savedFetch: typeof fetch;
let savedNavigator: unknown;
let savedDocument: unknown;

beforeEach(() => {
  savedFetch = globalThis.fetch;
  savedNavigator = (globalThis as Record<string, unknown>).navigator;
  savedDocument = (globalThis as Record<string, unknown>).document;
});

afterEach(() => {
  globalThis.fetch = savedFetch;
  (globalThis as Record<string, unknown>).navigator = savedNavigator;
  if (savedDocument === undefined) delete (globalThis as Record<string, unknown>).document;
  else (globalThis as Record<string, unknown>).document = savedDocument;
  setSystemTime();
});

// --- session ---------------------------------------------------------------

test("session id is stable within the idle window and rolls over after it", () => {
  setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const s = new Session({ sessionTimeout: 1000 });
  const first = s.getSessionId();

  setSystemTime(new Date("2026-01-01T00:00:00.500Z"));
  expect(s.getSessionId()).toBe(first);

  setSystemTime(new Date("2026-01-01T00:00:05Z"));
  expect(s.getSessionId()).not.toBe(first);
});

test("two sessions do not share state (no module globals)", () => {
  const a = new Session({ sessionId: "fixed-a" });
  const b = new Session({ sessionId: "fixed-b" });
  expect(a.getSessionId()).toBe("fixed-a");
  expect(b.getSessionId()).toBe("fixed-b");
});

// --- system props ----------------------------------------------------------

test("appVersion threads into system props (was previously discarded)", () => {
  expect(detectSystemProps("9.9.9").appVersion).toBe("9.9.9");
  expect(detectSystemProps().appVersion).toBe(null);
});

test("node system props use display os name, not raw platform/process.version", () => {
  const props = detectSystemProps();
  // Running under bun/node → mapped display name, never process.version as osVersion.
  expect(["macOS", "Windows", "Linux"]).toContain(props.osName);
  expect(props.osVersion).not.toBe(process.version);
});

// --- batching + flush ------------------------------------------------------

test("flushes automatically when the buffer reaches maxBatchSize", async () => {
  const calls = mockFetch();
  const a = new Analytics({ projectKey: "ck_test", maxBatchSize: 3, flushInterval: 1e9 });
  a.track("e1");
  a.track("e2");
  expect(calls.length).toBe(0);
  a.track("e3");
  await tick();
  expect(calls.length).toBe(1);
  const body = JSON.parse(String(calls[0].init.body));
  expect(Array.isArray(body)).toBe(true);
  expect(body.length).toBe(3);
  await a.destroy();
});

test("flush drains the whole buffer in <=50 batches", async () => {
  const calls = mockFetch();
  // maxBatchSize is capped at 50 even if a larger value is requested.
  const a = new Analytics({ projectKey: "ck_test", maxBatchSize: 500, flushInterval: 1e9 });
  for (let i = 0; i < 120; i++) a.track("e" + i);
  await tick();
  for (const c of calls) {
    const body = JSON.parse(String(c.init.body));
    const len = Array.isArray(body) ? body.length : 1;
    expect(len).toBeLessThanOrEqual(50);
  }
  // 120 events / 50 per batch => 3 requests.
  expect(calls.length).toBe(3);
  await a.destroy();
});

test("re-queues the batch when a send fails instead of dropping it", async () => {
  mockFetch(() => new Response("boom", { status: 500 }));
  const a = new Analytics({ projectKey: "ck_test", maxBatchSize: 50, flushInterval: 1e9 });
  a.track("e1");
  a.track("e2");
  await a.flush();

  // A subsequent successful flush must still carry the two retained events.
  const calls = mockFetch();
  await a.flush();
  expect(calls.length).toBe(1);
  const body = JSON.parse(String(calls[0].init.body));
  expect(body.length).toBe(2);
  await a.destroy();
});

test("pauses flushing after a 429 with Retry-After, then resumes", async () => {
  setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const calls = mockFetch(() => new Response("slow down", { status: 429, headers: { "Retry-After": "60" } }));
  const a = new Analytics({ projectKey: "ck_test", flushInterval: 1e9 });
  a.track("e1");
  await a.flush();
  expect(calls.length).toBe(1);

  // Still within the retry window → no new request.
  a.track("e2");
  await a.flush();
  expect(calls.length).toBe(1);

  // After the window passes, flushing resumes.
  setSystemTime(new Date("2026-01-01T00:01:01Z"));
  const ok = mockFetch();
  await a.flush();
  expect(ok.length).toBe(1);
  await a.destroy();
});

test("strips undefined props but keeps null", async () => {
  const calls = mockFetch();
  const a = new Analytics({ projectKey: "ck_test", maxBatchSize: 1, flushInterval: 1e9 });
  a.track("e", { keep: null, drop: undefined, num: 1 });
  await tick();
  const body = JSON.parse(String(calls[0].init.body)); // single event => object
  expect(body.props.keep).toBe(null);
  expect("drop" in body.props).toBe(false);
  expect(body.props.num).toBe(1);
  await a.destroy();
});

// --- beacon ----------------------------------------------------------------

test("page-hide beacon carries the key in the URL and chunks at <=50", async () => {
  const beacons: { url: string; size: number }[] = [];
  (globalThis as Record<string, unknown>).navigator = {
    sendBeacon: (url: string, blob: Blob) => {
      // Blob text isn't sync; infer size from the event count we know we sent.
      beacons.push({ url, size: -1 });
      void blob;
      return true;
    },
    userAgent: "",
    language: "en",
  };
  (globalThis as Record<string, unknown>).document = { visibilityState: "hidden" };
  // Fail fetch so auto-flushes re-queue and the buffer accumulates for the beacon.
  mockFetch(() => new Response("boom", { status: 500 }));

  const a = new Analytics({ projectKey: "ck_abc def", flushInterval: 1e9, maxBatchSize: 50 });
  for (let i = 0; i < 120; i++) a.track("e" + i);
  await tick();

  globalThis.dispatchEvent(new Event("visibilitychange"));

  // 120 events / 50 per chunk => 3 beacons.
  expect(beacons.length).toBe(3);
  for (const b of beacons) {
    // Key is URL-encoded in the query string (space => %20).
    expect(b.url).toContain("?key=ck_abc%20def");
    expect(b.url).toContain("/api/v0/event");
  }
  await a.destroy();
});

test("beacon falls back to keepalive fetch when sendBeacon returns false", async () => {
  (globalThis as Record<string, unknown>).navigator = {
    sendBeacon: () => false,
    userAgent: "",
    language: "en",
  };
  (globalThis as Record<string, unknown>).document = { visibilityState: "hidden" };
  const calls = mockFetch();

  const a = new Analytics({ projectKey: "ck_test", flushInterval: 1e9, maxBatchSize: 50 });
  a.track("e1");
  globalThis.dispatchEvent(new Event("visibilitychange"));
  await tick();

  const beaconFallback = calls.find((c) => c.url.includes("?key=ck_test"));
  expect(beaconFallback).toBeDefined();
  expect(beaconFallback!.init.keepalive).toBe(true);
  await a.destroy();
});

// --- aptabase shim ---------------------------------------------------------

test("aptabase sdk shim exposes the documented init/trackEvent call shape", () => {
  expect(() => {
    init("ck_test", { appVersion: "1.0.0" });
    trackEvent("page_view", { path: "/" });
  }).not.toThrow();
});

test("appVersion from Analytics options appears in each event's system props", async () => {
  const calls = mockFetch();
  const a = new Analytics({ projectKey: "ck_test", appVersion: "9.9.9", maxBatchSize: 1, flushInterval: 1e9 });
  a.track("save_settings", { theme: "dark" });
  await tick();
  const body = JSON.parse(String(calls[0].init.body));
  expect(body.systemProps.appVersion).toBe("9.9.9");
  expect(body.props.theme).toBe("dark");
  await a.destroy();
});
