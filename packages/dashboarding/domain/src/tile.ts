/**
 * Tile — where a question sits on a dashboard, and how it is drawn.
 *
 * Three concepts v1 tangled into two near-duplicate types:
 *
 *   Analysis  what to measure          (analytics, another context)
 *   Tile      placement + presentation (here, persisted)
 *   Readout   the computed answer      (readout.ts, transient)
 *
 * v1 had `Insight` (with `data`, and an *optional* query) and `InsightLayout`
 * (with a *required* query and no data). The loader hand-copied field by field
 * from one to the other, `persistLayout` hand-copied back, and any new field
 * had to be added in four places.
 *
 * Three things this fixes.
 *
 *   - **One width vocabulary.** v1 had three: 12-column units where 0 meant
 *     auto, templates emitting `span: 1|2|3`, and the configurator emitting
 *     `type === "metric" ? 1 : 2` which a later handler rewrote to 4 for
 *     metrics only. Under `spanToCols` every template tile collapsed to one
 *     column on the public share view. `TileWidth` is twelfths, 1 to 12, and
 *     that is the only vocabulary.
 *
 *   - **A tile names its project.** v1 made `projectId` optional on an insight
 *     and inherited it from the dashboard, which is how a metric card drew its
 *     headline number from one project and its sparkline from another, and how
 *     `dashboard.projectId ?? ""` reached a uuid parameter.
 *
 *   - **The analysis is opaque here.** `A` is the analytics context's Analysis
 *     IR, and `no-cross-context-domain` forbids importing it. That is not a
 *     workaround: a tile's job is placement and presentation, and every
 *     question *about* an analysis ("is this scalar?", "does it need identified
 *     people?") is an analytics question answered one layer up. See V3-SPEC §7.
 */

import type { ProjectId, TileId } from "@counted/kernel";

/** Twelfths of a row. The one width vocabulary. */
export type TileWidth = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** A row is twelve units wide. Nothing else in the system may disagree. */
export const ROW_UNITS = 12;

export const TileWidth = {
  THIRD: 4 as TileWidth,
  HALF: 6 as TileWidth,
  TWO_THIRDS: 8 as TileWidth,
  FULL: 12 as TileWidth,

  isValid: (n: number): n is TileWidth => Number.isInteger(n) && n >= 1 && n <= ROW_UNITS,
} as const;

/**
 * How an answer is drawn. Presentation only — which *query* runs is decided by
 * the analysis, not by this. v1 inferred the query from the drawing, so
 * changing a chart from a line to a number changed what was measured.
 */
export type TileView = "number" | "line" | "bar" | "table" | "funnel" | "retention";

export const TILE_VIEWS: readonly TileView[] = [
  "number",
  "line",
  "bar",
  "table",
  "funnel",
  "retention",
] as const;

export const isTileView = (value: unknown): value is TileView =>
  typeof value === "string" && (TILE_VIEWS as readonly string[]).includes(value);

/**
 * `A` is the analysis type, closed one layer up. Everything else here is
 * dashboarding's own: which project the question is asked of, how wide the
 * answer is drawn, and what it is called.
 */
export type TileLayout = { readonly x: number; readonly y: number; readonly height: number };
export type TilePlacement = TileLayout & { readonly id: TileId; readonly width: TileWidth };

export const validTileLayout = (layout: TileLayout, width: number): boolean =>
  Number.isInteger(layout.x) && layout.x >= 0 && layout.x + width <= ROW_UNITS &&
  Number.isInteger(layout.y) && layout.y >= 0 && layout.y <= 1000 &&
  Number.isInteger(layout.height) && layout.height >= 3 && layout.height <= 20;

export type Tile<A> = {
  readonly id: TileId;
  readonly title: string;
  /** Required. Never inherited from the dashboard. */
  readonly project: ProjectId;
  readonly analysis: A;
  readonly view: TileView;
  readonly width: TileWidth;
  readonly layout?: TileLayout;
};

export const Tile = {
  of: <A>(
    id: TileId,
    title: string,
    project: ProjectId,
    analysis: A,
    view: TileView = "number",
    width: TileWidth = TileWidth.HALF,
  ): Tile<A> => ({ id, title, project, analysis, view, width }),

  withTitle: <A>(t: Tile<A>, title: string): Tile<A> => ({ ...t, title }),
  withWidth: <A>(t: Tile<A>, width: TileWidth): Tile<A> => {
    const { layout, ...rest } = t;
    return { ...rest, width };
  },
  withoutLayout: <A>(t: Tile<A>): Tile<A> => { const { layout, ...rest } = t; return rest; },
  withView: <A>(t: Tile<A>, view: TileView): Tile<A> => ({ ...t, view }),
  withAnalysis: <A>(t: Tile<A>, analysis: A): Tile<A> => ({ ...t, analysis }),
} as const;
