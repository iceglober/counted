/**
 * Running one question, and discovering what questions a project can answer.
 *
 * `queries.run` fails with a *status* when the question cannot be answered —
 * 504 for an engine timeout, 501 for retention, 422 for an analysis the schema
 * cannot support. That is the opposite of `dashboards.readouts`, and the
 * difference is that here the failed question is the only one there was: a body
 * saying "no answer" beside a 200 is a shape every client has to special-case,
 * and most of them will not.
 *
 * `queries.dimensionValues` answers "what values could I filter on", for a
 * console building a picker. It was once how a breakdown got its rows — one
 * query per value, before litics could group — and is not any more; `limit`
 * stays required because an unbounded list of values is still a scan of the
 * dictionary nobody asked to pay for.
 */

import { Duration, Instant, isErr } from "@counted/kernel";
import {
  Analysis,
  DIMENSIONS,
  DimensionCatalog,
  dimensionSpec,
  isDimensionName,
} from "@counted/analytics-domain";
import { ask, readProjectSchema, type AskDeps } from "../analysis/ask";
import { toAnalysis } from "../analysis/wire";
import { fromEngineFailure, raise } from "../faults";
import type { HandlerDeps } from "./deps";
import { locatedProject, orAnalysisFault } from "./support";

export const queryRoutes = ({ deps, guarded }: HandlerDeps) => {
  const askDeps = (): AskDeps => ({ engine: deps.engine, catalog: deps.catalog });

  return {
    run: guarded.queries.run.handler(async ({ input, context }) => {
      const project = locatedProject(context.authority.located);
      const analysis = orAnalysisFault(toAnalysis(input.analysis));

      // `asOf` reproduces a chart somebody else saw. It replaces the request's
      // clock rather than sitting beside it, so every relative window in the
      // analysis resolves against the same instant the original did.
      const now =
        input.asOf === undefined
          ? context.at
          : (() => {
              const parsed = Instant.fromISO(input.asOf);
              if (isErr(parsed)) {
                raise({
                  code: "UNPROCESSABLE_CONTENT",
                  message: "The analysis cannot be answered.",
                  data: { reason: "InvalidAnalysis", detail: `asOf is not an instant: ${input.asOf}` },
                });
              }
              return parsed.value;
            })();

      const schema = await readProjectSchema(askDeps(), project);
      // Checked here as well as inside `ask`, so the caller gets the specific
      // 422 — `UnknownDimension`, `WindowTooLarge` — rather than the generic
      // `InvalidQuery` an engine failure would carry it back as.
      orAnalysisFault(Analysis.check(analysis, schema));

      const answer = await ask(
        askDeps(),
        {
          project,
          scope: { level: "project", project },
          analysis,
          now,
          deadline:
            input.deadlineMs === undefined
              ? deps.config.queryDeadline
              : Duration.millis(input.deadlineMs),
          traceId: context.traceId,
        },
        schema,
      );

      if (!answer.ok) raise(fromEngineFailure(answer.failure));

      return {
        readout: {
          id: context.traceId,
          value: answer.value,
          computedAt: Instant.toISO(answer.computedAt),
        },
      };
    }),

    /**
     * What this project's events actually offer.
     *
     * `status` distinguishes a dimension that is indexed from one the product
     * names but no event carries. `country` is the standing example: filtering
     * on it returns a stated refusal, and a console that could not tell the two
     * apart would offer it as a filter and then draw an empty chart.
     */
    schema: guarded.queries.schema.handler(async ({ context }) => {
      const project = locatedProject(context.authority.located);
      const [events, dimensions, measures, properties] = await Promise.all([
        deps.catalog.eventNames(project),
        deps.catalog.dimensions(project),
        deps.catalog.measures(project),
        deps.catalog.properties?.(project) ?? [],
      ]);

      const catalog = DimensionCatalog.of(
        dimensions,
        DIMENSIONS.filter((d) => d.availability === "planned" && !dimensions.includes(d.name)).map(
          (d) => d.name,
        ),
      );

      return {
        schema: {
          events: [...events],
          dimensions: [...DimensionCatalog.keys(catalog).map((name) => ({
            name,
            label: isDimensionName(name) ? dimensionSpec(name).label : name,
            status: DimensionCatalog.status(catalog, name),
            source: "dimension" as const,
          })), ...properties.map((name) => ({ name, label: name, status: "scanned" as const, source: "property" as const }))],
          measures: [...measures],
        },
      };
    }),

    dimensionValues: guarded.queries.dimensionValues.handler(async ({ input, context }) => {
      const project = locatedProject(context.authority.located);
      const values = await deps.catalog.dimensionValues(project, input.dimension, input.limit);
      return { values: [...values] };
    }),
  };
};
