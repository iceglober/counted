/**
 * The share page keeps its token.
 *
 * A share token is a credential — scoped, expiring, revocable, and enough to
 * read a dashboard without signing in. The design's rule is that it is
 * server-side-only material, exactly as a database credential was: it may sit
 * in the address bar, because that is what a share *link* is, but it must
 * never become something page JavaScript holds, serializes or sends.
 *
 * That is a property of the *files*, not of one render, so it is checked
 * against them. A prop added to the client component in six months would
 * serialize the token into the HTML for hydration, and no rendering test of
 * the happy path would notice.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const APP = join(import.meta.dir, "..", "..");
const read = (relative: string): string => readFileSync(join(APP, relative), "utf8");

/**
 * The file with its comments removed.
 *
 * For checks about what a page *says*. Searching the whole file matches the
 * comment explaining why a word is absent — which is how the first version of
 * the check below failed on its own documentation.
 */
const code = (relative: string): string =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const PAGE = "src/app/share/[token]/page.tsx";
const CONTROLS = "src/components/share-controls.tsx";
const BFF = "src/app/bff/share/[token]/render/route.ts";

describe("the token never reaches the browser", () => {
  test("the interactive component takes no props at all", () => {
    // The whole guarantee. A `token` prop would be serialized into the page
    // for hydration, which is precisely the leak this design avoids — and it
    // would look completely ordinary in review.
    const source = read(CONTROLS);
    expect(source).toMatch(/export const ShareControls = \(\) =>/);
    expect(source).not.toMatch(/ShareControls = \(\{/);
  });

  test("the page renders it with no arguments", () => {
    expect(read(PAGE)).toContain("<ShareControls />");
    expect(read(PAGE)).not.toMatch(/<ShareControls[^/>]*token/);
  });

  test("no client component builds an Authorization header", () => {
    // A same-origin BFF call is fine. One that carries a bearer is the token
    // escaping into JavaScript.
    for (const file of [CONTROLS]) {
      expect({ file, source: read(file) }).toMatchObject({
        source: expect.not.stringContaining("Bearer"),
      });
    }
  });

  test("the client reaches its own origin, by reading its own path", () => {
    // Derived from `location.pathname` rather than passed in — which is what
    // makes "takes no props" possible in the first place.
    const source = read(CONTROLS);
    expect(source).toContain("window.location.pathname");
    expect(source).toContain("/bff");
  });
});

describe("the token is used as a credential only on the server", () => {
  test("the page passes it as a bearer, server-side", () => {
    const source = read(PAGE);
    expect(source).toContain("getSharedDashboard");
    expect(source).toContain("bearer: token");
    // A server component, so none of this is shipped to the browser.
    expect(source).not.toContain('"use client"');
  });

  test("the page forwards no session cookie", () => {
    // A signed-in visitor reading a shared link is still only a share
    // principal: the link's scope is the link's, not theirs. Forwarding the
    // cookie would silently widen what the page can read.
    expect(read(PAGE)).toContain("serverApi(null)");
  });

  test("the BFF re-reads the token from its own path", () => {
    const source = read(BFF);
    expect(source).toContain("params: Promise<{ token: string }>");
    expect(source).toContain("bearer: token");
  });

  test("the BFF exists, because otherwise the browser would need the token", () => {
    expect(existsSync(join(APP, BFF))).toBe(true);
  });
});

describe("a shared link is not published", () => {
  test("the page declares noindex three ways", () => {
    // The API sends `X-Robots-Tag`, the page emits a meta tag, and robots.txt
    // disallows the path. A crawler that ignores one has to ignore three.
    const source = read(PAGE);
    expect(source).toContain("index: false");
    expect(source).toContain('content="noindex, nofollow, noarchive"');
  });

  test("robots.txt disallows the share path", () => {
    const source = read("src/app/robots.ts");
    expect(source).toContain("/share/");
    // And the BFF, which exists only to carry a credential.
    expect(source).toContain("/bff/");
  });

  test("the BFF's own responses are shielded too", () => {
    // A refresh response is the same data as the page. Letting it be cached or
    // indexed would undo the page's own headers.
    const source = read(BFF);
    expect(source).toContain("noindex, nofollow, noarchive");
    expect(source).toContain("private, no-store");
  });
});

describe("an unusable link", () => {
  test("reads as not found, never as forbidden", () => {
    // "Forbidden" confirms that some token exists there. One outcome for
    // expired, revoked and never-issued.
    const source = code(PAGE);
    expect(source).toContain("not available");
    expect(source.toLowerCase()).not.toContain("forbidden");
    expect(source.toLowerCase()).not.toContain("unauthorized");
  });

  test("the page still renders rather than throwing", () => {
    // A 500 on an expired link would page somebody at 3am for a link that did
    // exactly what it was supposed to.
    expect(read(PAGE)).toMatch(/catch\s*\{/);
  });
});
