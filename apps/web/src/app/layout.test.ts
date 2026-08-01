/**
 * The root layout carries two things that are invisible until they are gone.
 *
 * **The `retro` class.** Every rule in `retro.css` is scoped under it —
 * `.retro a`, `.retro .btn`, `.retro .page`, and the base font and background
 * on `.retro` itself. A bare `<body>` therefore ships the whole stylesheet and
 * applies none of it. That is not a subtle degradation: buttons render as plain
 * text, links fall back to browser defaults, and the 680px reading column
 * collapses to full width. It shipped to production exactly that way, with the
 * CSS in the bundle and the markup already saying `class="btn"` — one missing
 * class between them.
 *
 * **Open Graph and Twitter tags.** The launch plan is Show HN, Reddit and X,
 * and all three render their link preview from these. The layout previously
 * declared only `{ title, description }`, so a shared link showed a bare URL.
 *
 * Both failures look fine in code review and fine in a unit test of any single
 * page. They are only visible in a browser or a link unfurl, which is why they
 * get a test that reads the source rather than a rendering assertion.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const layout = readFileSync(join(import.meta.dir, "layout.tsx"), "utf8");
const retroCss = readFileSync(join(import.meta.dir, "retro.css"), "utf8");

describe("root layout", () => {
  test("applies the class the stylesheet is scoped to", () => {
    expect(layout).toMatch(/<body[^>]*className=["'][^"']*\bretro\b/);
  });

  test("retro.css is still scoped to that class, so the hook still matters", () => {
    // If someone unscopes the stylesheet the assertion above stops meaning
    // anything, and this is what tells them the pair moved out of step.
    expect(retroCss).toMatch(/^\.retro\s*\{/m);
    expect(retroCss).toMatch(/\.retro\s+\.btn\s*\{/);
  });

  test("declares Open Graph and Twitter cards", () => {
    expect(layout).toMatch(/openGraph\s*:/);
    expect(layout).toMatch(/twitter\s*:/);
  });

  test("sets metadataBase, without which OG urls resolve relative and crawlers drop them", () => {
    expect(layout).toMatch(/metadataBase\s*:/);
  });
});
