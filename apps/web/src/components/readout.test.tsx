/**
 * The three states, and the one that used to be two.
 *
 * v1's dashboard used `Promise.allSettled` with an `emptyData()` fallback, so
 * a rejected query became a blank chart — byte-identical to a project with no
 * events. The customer read a flat line as "my integration is broken" and went
 * looking in the wrong place.
 *
 * The wire contract already forbids that (`Outcome` has no zero value). These
 * tests are the rendering half: **a failure must never produce the same output
 * as an empty result**, for every failure code, and neither may be mistaken
 * for a zero.
 *
 * Rendered to a string with `renderToStaticMarkup` rather than into a DOM.
 * These are server components, that is how they actually run, and it keeps the
 * suite free of a DOM shim.
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReadoutBody, Tile, isEmpty, type Readout, type ReadoutFailure, type ReadoutValue } from "./readout";

const render = (element: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(element);

const CODES: readonly ReadoutFailure["code"][] = [
  "timeout",
  "unsupported",
  "store_unavailable",
  "invalid_request",
];

const failed = (code: ReadoutFailure["code"], retriable = true): Readout => ({
  id: "t1",
  ok: false,
  failure: { code, detail: `something went wrong: ${code}`, retriable },
});

const answered = (value: ReadoutValue): Readout => ({
  id: "t1",
  ok: true,
  value,
  computedAt: "2026-04-01T00:00:00.000Z",
});

const emptySeries = answered({ shape: "series", points: [] });

describe("a failure never renders as an empty result", () => {
  test("every failure code produces different output from an empty series", () => {
    // The load-bearing assertion of this file. Not "the error renders" — that
    // would pass while both rendered the same blank box.
    const blank = render(<ReadoutBody readout={emptySeries} />);
    for (const code of CODES) {
      const error = render(<ReadoutBody readout={failed(code)} />);
      expect({ code, sameAsEmpty: error === blank }).toMatchObject({ sameAsEmpty: false });
    }
  });

  test("a failure is announced to assistive technology; an empty result is not", () => {
    // An error a screen reader does not announce is an error somebody misses.
    for (const code of CODES) {
      expect(render(<ReadoutBody readout={failed(code)} />)).toContain('role="alert"');
    }
    expect(render(<ReadoutBody readout={emptySeries} />)).not.toContain('role="alert"');
  });

  test("a failure never draws a chart", () => {
    // The specific shape of the v1 bug: a failed query reaching the chart
    // renderer and painting a flat line at zero.
    for (const code of CODES) {
      const html = render(<ReadoutBody readout={failed(code)} />);
      expect({ code, hasSvg: html.includes("<svg") }).toMatchObject({ hasSvg: false });
    }
  });

  test("each failure code says something different, because each has a different fix", () => {
    // "Something went wrong" for all four sends everybody to support.
    const headlines = CODES.map((code) => render(<ReadoutBody readout={failed(code)} />));
    expect(new Set(headlines).size).toBe(CODES.length);
  });

  test("the server's own detail is shown, not replaced with a generic line", () => {
    expect(render(<ReadoutBody readout={failed("timeout")} />)).toContain("something went wrong: timeout");
  });

  test("whether retrying helps comes from the server, not from the code", () => {
    // The API decides retriability; guessing it from the code here would be a
    // second opinion free to disagree with the first.
    expect(render(<ReadoutBody readout={failed("timeout", true)} />)).toContain("retrying may help");
    expect(render(<ReadoutBody readout={failed("timeout", false)} />)).toContain("retrying will not help");
  });
});

describe("an empty result says which kind of empty it is", () => {
  test("each shape explains itself differently", () => {
    const messages = [
      render(<ReadoutBody readout={answered({ shape: "series", points: [] })} />),
      render(<ReadoutBody readout={answered({ shape: "breakdown", rows: [] })} />),
    ];
    expect(new Set(messages).size).toBe(2);
  });

  test("the wording is about the window, not about the project", () => {
    // "No events in this window" and "you have no events" are different
    // claims, and only one of them is something this page knows.
    const html = render(<ReadoutBody readout={answered({ shape: "series", points: [] })} />);
    expect(html).toContain("this window");
  });
});

describe("zero is a number, not an absence", () => {
  test("a scalar zero renders as 0", () => {
    // A project that genuinely recorded nothing today should say `0`. Reading
    // it as "empty" would hide a real, correct answer behind a shrug.
    expect(render(<ReadoutBody readout={answered({ shape: "scalar", value: 0 })} />)).toContain(">0<");
    expect(isEmpty({ shape: "scalar", value: 0 })).toBe(false);
  });

  test("a series of all zeroes is empty, because there is nothing to draw", () => {
    // Different from a scalar: a flat line at zero across every bucket carries
    // no more information than the sentence does, and the sentence is honest
    // about it.
    expect(isEmpty({ shape: "series", points: [{ bucketStart: "2026-01-01T00:00:00Z", value: 0 }] })).toBe(true);
  });

  test("a series with any value is drawn", () => {
    const html = render(
      <ReadoutBody
        readout={answered({
          shape: "series",
          points: [
            { bucketStart: "2026-01-01T00:00:00Z", value: 0 },
            { bucketStart: "2026-01-02T00:00:00Z", value: 5 },
          ],
        })}
      />,
    );
    expect(html).toContain("<svg");
  });
});

describe("a tile with no answer at all", () => {
  test("says the server did not answer, rather than drawing a blank", () => {
    // The store must answer every request it was given. A missing readout is
    // a failure to report, not an absence to render.
    const html = render(<Tile tile={{ id: "t1", title: "Signups", width: 6 }} readout={undefined} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("no answer");
  });

  test("and is visibly different from a tile whose query returned nothing", () => {
    const missing = render(<Tile tile={{ id: "t1", title: "Signups", width: 6 }} readout={undefined} />);
    const empty = render(<Tile tile={{ id: "t1", title: "Signups", width: 6 }} readout={emptySeries} />);
    expect(missing).not.toBe(empty);
  });
});

describe("layout", () => {
  test("width is in twelfths, the same unit the domain uses", () => {
    // v1 had three rival span vocabularies, hand-copied between two places.
    expect(render(<Tile tile={{ id: "t", title: "T", width: 4 }} readout={emptySeries} />)).toContain("span 4");
  });

  test("a width outside the grid is clamped rather than breaking the row", () => {
    expect(render(<Tile tile={{ id: "t", title: "T", width: 99 }} readout={emptySeries} />)).toContain("span 12");
    expect(render(<Tile tile={{ id: "t", title: "T", width: 0 }} readout={emptySeries} />)).toContain("span 1");
  });
});
