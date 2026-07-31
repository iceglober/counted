/**
 * Rendering one readout.
 *
 * This file exists to make one bug unrepresentable. v1 rendered a dashboard
 * with `Promise.allSettled` and an `emptyData()` fallback, so any rejection
 * became a blank chart indistinguishable from a project with no events. The
 * customer saw a flat line and concluded their integration was broken; it was
 * the query that failed.
 *
 * The contract already made that impossible on the wire — a `Readout` is
 * either `ok` with a value or `ok: false` with a named failure, and `Outcome`
 * has no zero value. This is the other half: **three states that render
 * differently**, decided by a `switch` on the readout rather than by whether
 * some array happened to be empty.
 *
 *   answered, with data  → the chart
 *   answered, no data    → a grey sentence explaining *why there is none*
 *   failed               → a red, bordered, named error
 *
 * The second and third are the ones that used to be the same pixel. They are
 * now different colours, different borders, and different words.
 */

import type { ReactElement } from "react";
import { SeriesChart } from "./series-chart";

export type ReadoutFailure = {
  readonly code: "timeout" | "unsupported" | "store_unavailable" | "invalid_request";
  readonly detail: string;
  readonly retriable: boolean;
};

export type ReadoutValue =
  | { readonly shape: "scalar"; readonly value: number }
  | { readonly shape: "series"; readonly points: readonly { bucketStart: string; value: number }[] }
  | { readonly shape: "breakdown"; readonly rows: readonly { label: string; value: number }[] };

export type Readout =
  | { readonly id: string; readonly ok: true; readonly value: ReadoutValue; readonly computedAt: string }
  | { readonly id: string; readonly ok: false; readonly failure: ReadoutFailure };

/**
 * What to say when a query succeeded and found nothing.
 *
 * Per failure-free shape, because "no rows" means something different for each
 * and a single "No data" is the sentence that made the v1 bug invisible. The
 * wording says what the *window* contains, not what the project contains —
 * those are different facts and conflating them sends people to the wrong fix.
 */
const EMPTY_MESSAGE: Readonly<Record<ReadoutValue["shape"], string>> = {
  scalar: "Nothing matched in this window.",
  series: "No events in this window.",
  breakdown: "No events in this window to group.",
};

/** Whether an answered readout actually carries anything to draw. */
export const isEmpty = (value: ReadoutValue): boolean => {
  switch (value.shape) {
    case "scalar":
      // Zero is a *number*, not an absence: a project that genuinely recorded
      // nothing today should show `0`, which is a fact. Only a scalar that is
      // not finite is missing.
      return !Number.isFinite(value.value);
    case "series":
      return value.points.length === 0 || value.points.every((p) => p.value === 0);
    case "breakdown":
      return value.rows.length === 0;
  }
};

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", { maximumFractionDigits: 1 });

/**
 * How a failure is described to somebody who has to act on it.
 *
 * Named per code, because the four have different fixes and "something went
 * wrong" sends everybody to the same place: support.
 */
const FAILURE_HEADLINE: Readonly<Record<ReadoutFailure["code"], string>> = {
  timeout: "This query took too long",
  unsupported: "This tile asks for something the store cannot do",
  store_unavailable: "The store could not be reached",
  invalid_request: "This tile is misconfigured",
};

export const FailureNotice = ({ failure }: { failure: ReadoutFailure }): ReactElement => (
  <div className="tile-error" role="alert">
    <div>
      <strong>{FAILURE_HEADLINE[failure.code]}</strong>
    </div>
    <div>{failure.detail}</div>
    <div className="tile-error-code">
      {failure.code}
      {/* Whether retrying helps is the server's judgement, not a guess made
          from the status code. It decides whether a Retry control appears. */}
      {failure.retriable ? " · retrying may help" : " · retrying will not help"}
    </div>
  </div>
);

const Value = ({ value }: { value: ReadoutValue }): ReactElement => {
  switch (value.shape) {
    case "scalar":
      return <div className="scalar">{formatNumber(value.value)}</div>;
    case "series":
      return <SeriesChart points={value.points} />;
    case "breakdown":
      return (
        <table>
          <tbody>
            {value.rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="numeric">{formatNumber(row.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
};

/**
 * The whole decision, in one place.
 *
 * A `switch` on the readout rather than a chain of truthiness checks: the
 * three states are exhaustive and the compiler says so, which is what stops a
 * fourth case from quietly falling through to the chart.
 */
export const ReadoutBody = ({ readout }: { readout: Readout }): ReactElement => {
  if (!readout.ok) return <FailureNotice failure={readout.failure} />;
  if (isEmpty(readout.value)) return <p className="tile-empty">{EMPTY_MESSAGE[readout.value.shape]}</p>;
  return <Value value={readout.value} />;
};

export type TileSpec = {
  readonly id: string;
  readonly title: string;
  readonly width: number;
};

/**
 * A tile, and its readout.
 *
 * `width` is in twelfths — the same unit the domain's `TileWidth` uses, so
 * there is no second layout vocabulary to disagree with the first. v1 had
 * three.
 */
export const Tile = ({ tile, readout }: { tile: TileSpec; readout: Readout | undefined }): ReactElement => (
  <section className="tile" style={{ gridColumn: `span ${Math.min(12, Math.max(1, tile.width))}` }}>
    <h2 className="tile-title">{tile.title}</h2>
    <div className="tile-body">
      {readout === undefined ? (
        // The server must answer every tile it was asked about. If one is
        // missing, say so — do not draw a blank and let it read as no data.
        <FailureNotice
          failure={{
            code: "store_unavailable",
            detail: "The server returned no answer for this tile.",
            retriable: true,
          }}
        />
      ) : (
        <ReadoutBody readout={readout} />
      )}
    </div>
  </section>
);
