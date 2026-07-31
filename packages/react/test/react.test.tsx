/**
 * The provider, driven through a real DOM.
 *
 * The suite it replaces rendered on the server and skipped its one client test
 * for want of a DOM — so no effect in this package had ever run in a test, and
 * the dependency bug it was supposed to catch survived under a green suite.
 *
 * Everything here is asserted through the network: what a provider does is
 * visible only as which credential the events arrive under, so that is what is
 * checked, rather than an internal instance count.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, createElement, StrictMode, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import * as index from "../src/index";
import { AnalyticsProvider, useAnalytics } from "../src/provider";
import { AptabaseProvider, useAptabase } from "../src/aptabase";
import type { CountedHandle } from "../src/use-counted";

// A DOM is not registered globally for the repo: the SDK branches on `window`
// and `navigator` to decide what platform it is on, so a DOM in the root test
// run would make every server-side SDK test report a browser. It is preloaded
// for this package only, which means these tests must run from here.
if (typeof document === "undefined") {
  throw new Error(
    "These tests need a DOM. Run them from packages/react — `bun run --cwd packages/react test` — where bunfig.toml preloads one.",
  );
}

type Sent = { readonly key: string; readonly events: readonly Record<string, unknown>[] };

let sent: Sent[] = [];
let container: HTMLElement;
let root: Root | null = null;

const captureFetch = (async (_url: unknown, init: RequestInit) => {
  const headers = new Headers(init.headers as HeadersInit);
  const body = JSON.parse(String(init.body)) as { events: Record<string, unknown>[] };
  sent.push({ key: (headers.get("authorization") ?? "").replace("Bearer ", ""), events: body.events });
  return new Response(JSON.stringify({ accepted: body.events.length, deduplicated: 0, rejected: 0 }), {
    status: 202,
    headers: { "content-type": "application/json" },
  });
}) as unknown as typeof fetch;

beforeEach(() => {
  sent = [];
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  if (root !== null) {
    const current = root;
    await act(async () => current.unmount());
  }
  root = null;
  container.remove();
});

const render = async (element: ReactNode): Promise<void> => {
  await act(async () => {
    root ??= createRoot(container);
    root.render(element);
  });
};

/** Every event sent under a given credential, flattened. */
const eventsFor = (key: string): readonly Record<string, unknown>[] =>
  sent.filter((s) => s.key === key).flatMap((s) => s.events);

/** Hands the handle back to the test once the provider is live. */
const Probe = ({ onReady }: { onReady: (handle: CountedHandle) => void }) => {
  const handle = useAnalytics();
  useEffect(() => {
    onReady(handle);
  }, [handle, onReady]);
  return null;
};

// `children` comes from createElement's third argument, which its prop types
// do not model; both helpers exist only to say that once.
const provider = (props: Record<string, unknown>, child: ReactNode) =>
  createElement(AnalyticsProvider, props as never, child);

const aptabase = (props: Record<string, unknown>, child: ReactNode) =>
  createElement(AptabaseProvider, props as never, child);

describe("a changed option rebuilds the client", () => {
  test("a changed projectKey sends subsequent events under the new key", async () => {
    // The bug. The dependency list was `[]`, so the client was constructed
    // once with whatever key the first render happened to carry, and every
    // later event went to the wrong project — silently, forever.
    let handle!: CountedHandle;
    const tree = (projectKey: string) =>
      provider(
        { projectKey, fetch: captureFetch, flushIntervalMs: 100_000 },
        createElement(Probe, { onReady: (h: CountedHandle) => void (handle = h) }),
      );

    await render(tree("ck_first"));
    await act(async () => {
      handle.track("before");
      await handle.flush();
    });

    await render(tree("ck_second"));
    await act(async () => {
      handle.track("after");
      await handle.flush();
    });

    expect(eventsFor("ck_first").map((e) => e["name"])).toEqual(["before"]);
    expect(eventsFor("ck_second").map((e) => e["name"])).toEqual(["after"]);
  });

  test("a changed endpoint is honoured too, not just the key", async () => {
    // `[projectKey]` would have been the tempting narrow fix, and would have
    // left every other option frozen at first render.
    const urls: string[] = [];
    const spy = (async (url: unknown, init: RequestInit) => {
      urls.push(String(url));
      return (captureFetch as unknown as (u: unknown, i: RequestInit) => Promise<Response>)(url, init);
    }) as unknown as typeof fetch;

    let handle!: CountedHandle;
    const tree = (endpoint: string) =>
      provider(
        { projectKey: "ck_x", endpoint, fetch: spy, flushIntervalMs: 100_000 },
        createElement(Probe, { onReady: (h: CountedHandle) => void (handle = h) }),
      );

    await render(tree("https://one.example/v1/events"));
    await act(async () => {
      handle.track("a");
      await handle.flush();
    });
    await render(tree("https://two.example/v1/events"));
    await act(async () => {
      handle.track("b");
      await handle.flush();
    });

    expect(urls).toEqual(["https://one.example/v1/events", "https://two.example/v1/events"]);
  });

  test("what the old client still held is flushed under the old key", async () => {
    // A rebuild must not drop the queue. Those events were tracked while the
    // first credential was current, so they belong to that project.
    let handle!: CountedHandle;
    const tree = (projectKey: string) =>
      provider(
        { projectKey, fetch: captureFetch, flushIntervalMs: 100_000 },
        createElement(Probe, { onReady: (h: CountedHandle) => void (handle = h) }),
      );

    await render(tree("ck_first"));
    act(() => handle.track("queued"));
    // No flush — it is sitting in the first client's queue.
    await render(tree("ck_second"));
    await act(async () => {});

    expect(eventsFor("ck_first").map((e) => e["name"])).toEqual(["queued"]);
    expect(eventsFor("ck_second")).toEqual([]);
  });
});

describe("an unchanged option does not rebuild it", () => {
  test("re-rendering with equal props keeps one visit", async () => {
    // The other half of the fix, and the reason the dependency list cannot
    // simply be `[options]`: the provider takes its options as a rest spread,
    // so that object is a new identity on every render, and depending on it
    // would rebuild the client — restarting the visit — every time the parent
    // re-rendered.
    let handle!: CountedHandle;
    const tree = () =>
      provider(
        // A fresh object literal each time, deliberately.
        { projectKey: "ck_x", fetch: captureFetch, flushIntervalMs: 100_000 },
        createElement(Probe, { onReady: (h: CountedHandle) => void (handle = h) }),
      );

    await render(tree());
    act(() => handle.track("one"));
    await render(tree());
    await render(tree());
    await act(async () => {
      handle.track("two");
      await handle.flush();
    });

    const visits = new Set(eventsFor("ck_x").map((e) => e["visitId"]));
    expect({ events: eventsFor("ck_x").length, visits: visits.size }).toEqual({ events: 2, visits: 1 });
  });

  test("prop order and an explicit undefined do not count as a change", async () => {
    let handle!: CountedHandle;
    await render(
      provider(
        { projectKey: "ck_x", fetch: captureFetch, flushIntervalMs: 100_000 },
        createElement(Probe, { onReady: (h: CountedHandle) => void (handle = h) }),
      ),
    );
    act(() => handle.track("one"));
    await render(
      provider(
        { flushIntervalMs: 100_000, appVersion: undefined, fetch: captureFetch, projectKey: "ck_x" },
        createElement(Probe, { onReady: (h: CountedHandle) => void (handle = h) }),
      ),
    );
    await act(async () => {
      handle.track("two");
      await handle.flush();
    });

    expect(new Set(eventsFor("ck_x").map((e) => e["visitId"])).size).toBe(1);
  });
});

describe("identity across a rebuild", () => {
  const tree = (projectKey: string, onReady: (h: CountedHandle) => void) =>
    provider(
      { projectKey, fetch: captureFetch, flushIntervalMs: 100_000 },
      createElement(Probe, { onReady }),
    );

  test("an identified person stays identified when the key changes", async () => {
    // A configuration change is not a sign-out. Dropping the person here would
    // orphan their events, with nothing in the data to say it happened.
    let handle!: CountedHandle;
    const ready = (h: CountedHandle) => void (handle = h);

    await render(tree("ck_first", ready));
    act(() => handle.identify("u_42"));
    await render(tree("ck_second", ready));
    await act(async () => {
      handle.track("after");
      await handle.flush();
    });

    expect(eventsFor("ck_second")[0]).toMatchObject({ name: "after", userId: "u_42" });
  });

  test("a reset before the rebuild stays reset", async () => {
    let handle!: CountedHandle;
    const ready = (h: CountedHandle) => void (handle = h);

    await render(tree("ck_first", ready));
    act(() => {
      handle.identify("u_42");
      handle.reset();
    });
    await render(tree("ck_second", ready));
    await act(async () => {
      handle.track("after");
      await handle.flush();
    });

    expect(eventsFor("ck_second")[0]).not.toHaveProperty("userId");
  });
});

describe("calls made before the client exists", () => {
  test("they replay in the order they were made", async () => {
    // Held in one list rather than one per method: replaying every identify
    // before every track would attribute an event tracked while signed out to
    // whoever signed in afterwards.
    let handle!: CountedHandle;

    const Eager = () => {
      const h = useAnalytics();
      // During render, before any effect has run.
      h.track("anonymous");
      h.identify("u_7");
      h.track("named");
      useEffect(() => void (handle = h), [h]);
      return null;
    };

    await render(
      provider({ projectKey: "ck_x", fetch: captureFetch, flushIntervalMs: 100_000 }, createElement(Eager)),
    );
    await act(async () => handle.flush());

    const events = eventsFor("ck_x");
    expect(events.map((e) => e["name"])).toEqual(["anonymous", "named"]);
    expect(events[0]).not.toHaveProperty("userId");
    expect(events[1]).toMatchObject({ userId: "u_7" });
  });
});

describe("StrictMode", () => {
  test("the double mount leaves a live client, not a destroyed one", async () => {
    // React 18+ mounts, tears down and mounts again in development. A provider
    // that destroys its only instance on that first cleanup looks fine in
    // production and sends nothing in development.
    let handle!: CountedHandle;
    await render(
      createElement(
        StrictMode,
        null,
        provider(
          { projectKey: "ck_x", fetch: captureFetch, flushIntervalMs: 100_000 },
          createElement(Probe, { onReady: (h: CountedHandle) => void (handle = h) }),
        ),
      ),
    );

    await act(async () => {
      handle.track("after-strict");
      await handle.flush();
    });

    expect(eventsFor("ck_x").map((e) => e["name"])).toContain("after-strict");
  });
});

describe("the Aptabase shim behaves identically", () => {
  const AptProbe = ({ onReady }: { onReady: (t: (n: string) => void) => void }) => {
    const { trackEvent } = useAptabase();
    useEffect(() => onReady(trackEvent), [trackEvent, onReady]);
    return null;
  };

  test("a changed appVersion rebuilds — the half it used to ignore", async () => {
    // The old shim keyed on `[appKey]` only, so an app that read its version
    // asynchronously reported whatever it had at first render, forever.
    const original = globalThis.fetch;
    globalThis.fetch = captureFetch;
    try {
      let track!: (n: string) => void;
      const tree = (appVersion: string) =>
        aptabase(
          { appKey: "A-US-1", options: { appVersion } },
          createElement(AptProbe, { onReady: (t: (n: string) => void) => void (track = t) }),
        );

      await render(tree("1.0.0"));
      await render(tree("1.1.0"));
      act(() => track("e"));
      // The queued event leaves on the next rebuild's shutdown flush.
      await render(tree("1.2.0"));
      await act(async () => {});

      const versions = sent
        .flatMap((s) => s.events)
        .map((e) => (e["systemProperties"] as Record<string, unknown>)["app_version"]);
      expect(versions).toEqual(["1.1.0"]);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("host maps onto the ingest endpoint", async () => {
    const urls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init: RequestInit) => {
      urls.push(String(url));
      return (captureFetch as unknown as (u: unknown, i: RequestInit) => Promise<Response>)(url, init);
    }) as unknown as typeof fetch;
    try {
      let track!: (n: string) => void;
      await render(
        aptabase(
          { appKey: "A-US-1", options: { host: "https://self.hosted/" } },
          createElement(AptProbe, { onReady: (t: (n: string) => void) => void (track = t) }),
        ),
      );
      act(() => track("e"));
      const current = root;
      if (current !== null) await act(async () => current.unmount());
      root = null;
      expect(urls).toEqual(["https://self.hosted/v1/events"]);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("the package's surface", () => {
  test("both pairs are exported from the index", () => {
    // The asymmetry: the Aptabase pair was reachable only from a subpath, so
    // it was the half nobody read and the half that drifted.
    expect(Object.keys(index).sort()).toEqual(
      ["AnalyticsProvider", "AptabaseProvider", "useAnalytics", "useAptabase", "useCounted"].sort(),
    );
  });

  test("the index and the subpath are the same components", async () => {
    const subpath = await import("../src/aptabase");
    expect(index.AptabaseProvider).toBe(subpath.AptabaseProvider);
    expect(index.useAptabase).toBe(subpath.useAptabase);
  });

  test("each hook names its own provider when used outside one", () => {
    const bad = (hook: () => unknown) => () =>
      renderToStaticMarkup(
        createElement(() => {
          hook();
          return null;
        }),
      );
    expect(bad(useAnalytics)).toThrow(/useAnalytics must be used within/);
    expect(bad(useAptabase)).toThrow(/useAptabase must be used within/);
  });

  test("children still render on the server, and no client is built there", () => {
    // Effects do not run during `renderToStaticMarkup`, so nothing is
    // constructed; this asserts the provider does not reach for a DOM during
    // render either.
    const html = renderToStaticMarkup(
      provider({ projectKey: "ck_x" }, createElement("span", null, "hello")),
    );
    expect(html).toContain("hello");
    expect(sent).toEqual([]);
  });
});
