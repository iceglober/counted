/**
 * Tile — where a question sits on a dashboard, and how it is drawn.
 *
 * Three concepts that v1 tangled into two near-duplicate types:
 *
 *   Analysis  what to measure          (analytics/)
 *   Tile      placement + presentation (here, persisted)
 *   Readout   the computed answer      (readout.ts, transient)
 *
 * v1 had `Insight` (with `data`, and an *optional* query) and `InsightLayout`
 * (with a *required* query and no data). The loader hand-copied field by field
 * from one to the other, `persistLayout` hand-copied back, and any new field
 * had to be added in four places.
 *
 * Two other things this fixes:
 *
 *   - **One width vocabulary.** v1 had three: 12-column units where 0 meant
 *     auto, templates emitting `span: 1|2|3`, and the configurator emitting
 *     `type === "metric" ? 1 : 2` which a later handler rewrote to 4 for
 *     metrics only. Under `spanToCols` every template tile collapsed to one
 *     column on the public share view. `TileWidth` is twelfths, 1 to 12, and
 *     that is the only vocabulary.
 *
 *   - **A tile names its project.** v1 made `projectId` optional on an insight
 *     and inherited it from the dashboard, which is how a metric card ended up
 *     drawing its headline number from one project and its sparkline from
 *     another, and how `dashboard.projectId ?? ""` reached a uuid parameter.
 */

import type { Brand } from "../shared/brand";
import type { ProjectId } from "../shared/ids";
import type { Analysis } from "../analytics/analysis";
import type { Funnel } from "../analytics/funnel";
import type { Retention } from "../analytics/retention";
import type { SummaryStat } from "../analytics/trend";

export type TileId = Brand<string, "TileId">;
export const TileId = (raw: string): TileId => raw as TileId;

/** Twelfths of a row. The one width vocabulary. */
export type TileWidth = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export const ROW_UNITS = 12;

export const TileWidth = {
  THIRD: 4 as TileWidth,
  HALF: 6 as TileWidth,
  TWO_THIRDS: 8 as TileWidth,
  FULL: 12 as TileWidth,

  isValid: (n: number): n is TileWidth => Number.isInteger(n) && n >= 1 && n <= ROW_UNITS,
} as const;

/** How an analysis result is drawn. A time series can be a line or bars. */
export type AnalysisView = "number" | "line" | "bar" | "table";

/**
 * What a tile shows. The variant decides which query the store runs, so the
 * three question shapes stay distinguishable rather than being inferred from
 * whether some optional field happened to be set.
 */
export type TileContent =
  | {
      readonly kind: "analysis";
      readonly analysis: Analysis;
      readonly view: AnalysisView;
      /** For a `number` view over a series: which figure to headline. */
      readonly summary?: SummaryStat;
    }
  | { readonly kind: "funnel"; readonly funnel: Funnel }
  | { readonly kind: "retention"; readonly retention: Retention };

export type Tile = {
  readonly id: TileId;
  readonly title: string;
  /** Required. Never inherited from the dashboard. */
  readonly project: ProjectId;
  readonly content: TileContent;
  readonly width: TileWidth;
};

export const Tile = {
  of: (
    id: TileId,
    title: string,
    project: ProjectId,
    content: TileContent,
    width: TileWidth = TileWidth.HALF,
  ): Tile => ({ id, title, project, content, width }),

  withWidth: (t: Tile, width: TileWidth): Tile => ({ ...t, width }),
  withTitle: (t: Tile, title: string): Tile => ({ ...t, title }),
  withContent: (t: Tile, content: TileContent): Tile => ({ ...t, content }),

  /** True when this tile can only be answered on identified events. */
  requiresPerson: (t: Tile): boolean => {
    switch (t.content.kind) {
      case "analysis":
        return t.content.analysis.measure.kind === "distinct" &&
          t.content.analysis.measure.basis === "person";
      case "funnel":
        return t.content.funnel.basis === "person";
      case "retention":
        return true;
      default:
        return false;
    }
  },
} as const;
