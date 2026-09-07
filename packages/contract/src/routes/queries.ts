/**
 * Running a question, and discovering what questions a project can answer.
 *
 * `queries.run` fails with a status when the question cannot be answered —
 * 504 for an engine timeout, 501 for retention, 422 for an analysis the schema
 * cannot support. That is the opposite of `dashboards.readouts`, and the
 * difference is that here the failed question is the only one there was: a body
 * saying "no answer" with a 200 beside it is a shape every client has to
 * special-case, and most of them will not.
 *
 * `queries.dimensionValues` is how a console offers a filter's values before
 * anyone has typed one. It used to be load-bearing for a different reason —
 * a breakdown was one query per value and the list had to be fetched first —
 * and that is no longer true: litics groups, so the rows of a breakdown come
 * from the data. What is left is the picker, which is what the name says.
 */

import { oc } from "@orpc/contract";
import * as z from "zod";
import { route } from "../route";
import { QUERY_ERRORS } from "../errors";
import { DurationMsSchema, ProjectIdSchema, queryInt } from "../primitives";
import { AnalysisSchema, ProjectSchemaSchema } from "../schemas/analysis";
import { AnsweredReadoutSchema } from "../schemas/readout";

const TAGS = ["queries"] as const;

export const run = oc
  .meta(
    route({
      id: "queries.run",
      method: "POST",
      path: "/v1/projects/{projectId}/queries",
      summary: "Run one analysis",
      description:
        "POST because the question is a document, not a query string. It has no side effects and may be retried.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "queries:run",
        resource: "project",
        param: "projectId",
      },
    }),
  )
  .errors(QUERY_ERRORS)
  .input(
    z.object({
      projectId: ProjectIdSchema,
      analysis: AnalysisSchema,
      /** How long the engine may take before it gives up and says so. */
      deadlineMs: DurationMsSchema.optional(),
      /**
       * Resolve relative windows against this instant instead of now. Only
       * useful for reproducing a chart someone else saw.
       */
      asOf: z.iso.datetime().optional(),
    }),
  )
  .output(z.object({ readout: AnsweredReadoutSchema }));

export const schema = oc
  .meta(
    route({
      id: "queries.schema",
      method: "GET",
      path: "/v1/projects/{projectId}/schema",
      summary: "List the events, dimensions and measures this project carries",
      description:
        "A dimension's `status` distinguishes one that is indexed from one that is declared but not collected yet. Filtering on a `planned` dimension is refused rather than answered with an empty chart.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "queries:run",
        resource: "project",
        param: "projectId",
      },
    }),
  )
  .errors(QUERY_ERRORS)
  .input(z.object({ projectId: ProjectIdSchema }))
  .output(z.object({ schema: ProjectSchemaSchema }));

export const dimensionValues = oc
  .meta(
    route({
      id: "queries.dimensionValues",
      method: "GET",
      path: "/v1/projects/{projectId}/dimensions/{dimension}/values",
      summary: "List the values a dimension takes",
      description:
        "`limit` is required rather than defaulted server-side, because the number of values is the number of queries a breakdown over them will cost.",
      tags: TAGS,
      authorize: {
        kind: "resource",
        permission: "queries:run",
        resource: "project",
        param: "projectId",
      },
      query: { limit: "primitive" },
    }),
  )
  .errors(QUERY_ERRORS)
  .input(
    z.object({
      projectId: ProjectIdSchema,
      dimension: z.string().min(1),
      limit: queryInt(1, 100),
    }),
  )
  .output(z.object({ values: z.array(z.string()) }));
