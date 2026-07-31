/**
 * A time series, as straight segments.
 *
 * No smoothing. A bezier through the points invents values between them —
 * a curve dipping below zero between two positive buckets is drawing data that
 * does not exist — and the angular polyline reads the numbers literally, which
 * is also what the plain house style wants.
 *
 * The area fill is a single-hue gradient fading to the baseline. It is the one
 * gradient in the product, and it is here because it encodes magnitude rather
 * than decorating a surface; the design's ban on gradients is about chrome.
 *
 * Rendered on the server with no measurement and no state. A chart that needs
 * a `useEffect` to size itself paints once at the wrong size first, and the
 * viewBox does the same job with none of that.
 */

import type { ReactElement } from "react";

export type Point = { readonly bucketStart: string; readonly value: number };

/** The coordinate space. Scaled by CSS, so these are ratios, not pixels. */
const WIDTH = 480;
const HEIGHT = 140;
/** Room for the line's own stroke at the extremes, so it is never clipped. */
const PADDING = 3;

export type Geometry = {
  readonly line: string;
  readonly area: string;
  readonly max: number;
};

/**
 * Points to paths.
 *
 * Separated from the component so it can be tested as arithmetic — the failure
 * mode of a chart is a wrong number silently drawn, which no snapshot of an
 * SVG string would catch.
 */
export const geometryFor = (points: readonly Point[]): Geometry => {
  // A baseline of zero, always. Scaling to the minimum makes a series that
  // ranges 900–1000 look like it fell to nothing, which is the single most
  // common way a chart lies.
  const max = Math.max(0, ...points.map((p) => p.value));
  const usableWidth = WIDTH - PADDING * 2;
  const usableHeight = HEIGHT - PADDING * 2;

  const x = (index: number): number =>
    // One point has no span to divide, so it sits at the left edge rather than
    // dividing by zero and rendering `NaN` into the path.
    points.length <= 1 ? PADDING : PADDING + (index / (points.length - 1)) * usableWidth;

  // A flat series at zero has no scale; drawing it along the baseline is
  // truthful, where dividing by zero would erase it.
  const y = (value: number): number => (max === 0 ? HEIGHT - PADDING : HEIGHT - PADDING - (value / max) * usableHeight);

  const coordinates = points.map((point, index) => ({ x: x(index), y: y(point.value) }));
  const line = coordinates.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(" ");

  const area =
    coordinates.length === 0
      ? ""
      : `${line} L ${coordinates[coordinates.length - 1]!.x.toFixed(2)} ${HEIGHT - PADDING} L ${coordinates[0]!.x.toFixed(2)} ${HEIGHT - PADDING} Z`;

  return { line, area, max };
};

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", { maximumFractionDigits: 1 });

export const SeriesChart = ({ points }: { points: readonly Point[] }): ReactElement => {
  const { line, area, max } = geometryFor(points);
  // Stable across renders and unique per chart, without `useId` — this is a
  // server component, and two charts on one page must not share a gradient.
  const gradientId = `fill-${points.length}-${Math.round(max)}`;

  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "7rem", display: "block" }}
        role="img"
        aria-label={`${points.length} buckets, peak ${formatNumber(max)}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={area} fill={`url(#${gradientId})`} stroke="none" />
        <path
          d={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.5"
          // Mitred joins, not rounded: the corners are where the data changes
          // direction, and softening them softens the reading.
          strokeLinejoin="miter"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="tile-empty" style={{ marginTop: "0.25rem" }}>
        peak {formatNumber(max)}
      </figcaption>
    </figure>
  );
};
