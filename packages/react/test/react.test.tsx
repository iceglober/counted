import { test, expect } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnalyticsProvider, useAnalytics } from "../src/provider";
import { AptabaseProvider, useAptabase } from "../src/aptabase";

// These tests render on the server (no DOM required). They exercise the SSR
// guard (no Analytics constructed server-side) and the public hook contracts.
// The StrictMode client-timer test at the bottom needs a DOM and is skipped
// where one isn't available.

test("AnalyticsProvider renders children during SSR without throwing", () => {
  const html = renderToStaticMarkup(
    createElement(
      AnalyticsProvider,
      { projectKey: "ck_test" },
      createElement("span", null, "hello"),
    ),
  );
  expect(html).toContain("hello");
});

test("useAnalytics throws when used outside a provider", () => {
  function Bad() {
    useAnalytics();
    return null;
  }
  expect(() => renderToStaticMarkup(createElement(Bad))).toThrow(
    /useAnalytics must be used within/,
  );
});

test("AptabaseProvider accepts appKey + options and renders children (SSR)", () => {
  const html = renderToStaticMarkup(
    createElement(
      AptabaseProvider,
      { appKey: "A-US-0000000000", options: { appVersion: "1.0.0" } },
      createElement("span", null, "aptabase-ok"),
    ),
  );
  expect(html).toContain("aptabase-ok");
});

test("useAptabase exposes trackEvent and throws outside a provider", () => {
  let shape: unknown;
  function Reader() {
    shape = useAptabase();
    return null;
  }
  renderToStaticMarkup(
    createElement(
      AptabaseProvider,
      { appKey: "A-US-0000000000" },
      createElement(Reader),
    ),
  );
  expect(typeof (shape as { trackEvent: unknown }).trackEvent).toBe("function");

  function Bad() {
    useAptabase();
    return null;
  }
  expect(() => renderToStaticMarkup(createElement(Bad))).toThrow(
    /useAptabase must be used within/,
  );
});

// Requires a DOM (jsdom/happy-dom) to run react-dom/client + effects. Skipped
// automatically where no DOM is registered. Asserts that under StrictMode's
// mount → cleanup → mount cycle the provider ends with a *live* Analytics
// instance whose flush timer still fires (regression: it used to destroy the
// only instance and never restart).
test.skipIf(typeof document === "undefined")(
  "StrictMode leaves a live flush timer",
  async () => {
    const { StrictMode } = await import("react");
    const { createRoot } = await import("react-dom/client");

    const container = document.createElement("div");
    document.body.appendChild(container);

    let flushes = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      flushes++;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    function Emitter() {
      const { track } = useAnalytics();
      track("page_view");
      return null;
    }

    const root = createRoot(container);
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(
          AnalyticsProvider,
          { projectKey: "ck_test", flushInterval: 10 },
          createElement(Emitter),
        ),
      ),
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(flushes).toBeGreaterThan(0);

    root.unmount();
    globalThis.fetch = origFetch;
  },
);
