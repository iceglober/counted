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

  /**
   * The class being applied is not the same as the stylesheet covering what
   * the app renders, and the gap between those two is where the console spent
   * its life unstyled.
   *
   * Every rule was either a class the marketing pages opt into (`.page`,
   * `.btn`) or an element the marketing pages use (`a`, `h1`, `table`). The
   * console is semantic HTML — real `<button>`, `<input>`, `<main>`, no
   * classes — so `body.retro` was present, the CSS loaded, and nothing
   * matched. Sign-in was a bare heading, a borderless field, and a line of
   * text where the button belonged.
   *
   * These assert the stylesheet covers the primitives the console actually
   * emits, which is the thing that was missing rather than the hook.
   */
  test("styles the form controls the console renders", () => {
    for (const selector of [/\.retro\s+button\s*[,{]/, /\.retro\s+input\s*[,{]/, /\.retro\s+select\s*[,{]/, /\.retro\s+textarea\s*[,{]/]) {
      expect(retroCss).toMatch(selector);
    }
  });

  test("constrains <main>, since no console page opts into .page", () => {
    // Marketing wraps its content in `div.page`; the console does not, so
    // without this its pages run the full width of the window.
    expect(retroCss).toMatch(/\.retro\s+main\s*\{[^}]*max-width/);
  });

  test("keyboard focus stays visible on form controls", () => {
    // The bevel does not change on :focus, so focus needs its own treatment or
    // a keyboard user cannot tell where they are.
    expect(retroCss).toMatch(/\.retro\s+(input|button|select|textarea):focus-visible/);
  });
});
