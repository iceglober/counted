/**
 * SchemaCatalog — which event names, dimensions and measures a project has
 * actually seen.
 *
 * Its own port because v1 answered this by scanning the project's entire
 * history on every configurator open: six parallel queries, including a
 * `jsonb_each_text` lateral expansion of every property of every row with a
 * regex per value. It needs a maintained catalog, not a live scan — and under
 * litics one exists, because dimension values are dictionary-encoded and event
 * types are namespaced per stream.
 *
 * `dimensionValues` earns its place as the picker: what a console offers
 * someone who is about to filter, before they have typed anything. It was also
 * how a breakdown got its rows, back when the engine had no group-by and a
 * table meant one query per value; `AnalyticsEngine.countsBy` does that now, so
 * this is a list for a person rather than a fan-out plan.
 */

import type { ProjectId } from "@counted/kernel";

export interface SchemaCatalog {
  /** Recent custom-property suggestions, kept separate from indexed dimensions. */
  properties?(project: ProjectId): Promise<readonly string[]>;
  eventNames(project: ProjectId): Promise<readonly string[]>;

  /** Dimensions the store indexes. Anything else is a slow path. */
  dimensions(project: ProjectId): Promise<readonly string[]>;

  /**
   * Distinct values seen for one dimension, most frequent first, capped.
   *
   * The cap is not politeness: an open-set dimension like `device_model` grows
   * with every customer's device mix, and a picker that lists all of them is a
   * scan of the dictionary for a menu nobody scrolls.
   */
  dimensionValues(
    project: ProjectId,
    dimension: string,
    limit: number,
  ): Promise<readonly string[]>;

  /** Numeric measures available to `sums`. */
  measures(project: ProjectId): Promise<readonly string[]>;
}
