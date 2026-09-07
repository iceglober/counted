"use server";

/**
 * Tile writes — six routes, not one dashboard-replacing PUT.
 *
 * They stay separate because they are separate refusals. `resize` can answer
 * `WidthUnchanged`, `move` can answer `PositionUnchanged` or `IndexOutOfRange`,
 * and folding them into one PATCH collapses three specific answers into
 * "invalid". The console renders each of those as its own sentence, which is
 * only possible because the API can tell them apart.
 */

import { attempt } from "../lib/client";
import type { Failure } from "../lib/failure";
import { clientForCaller } from "../lib/session";
import { finish, finishCreation } from "../lib/act";
import { build, titleFor, type Draft } from "../lib/analysis";
import { integer, optional, returnTo, text } from "../lib/form";

/**
 * One tile from one draft. The single place a draft becomes a tile.
 */
const addFromDraft = async (
  form: FormData,
  draft: Draft,
  title: string,
): Promise<Failure | null> => {
  const dashboardId = text(form, "dashboardId");
  const back = returnTo(form, "/");

  const built = build(draft);
  if (!built.ok) {
    // Refused here rather than posted and refused there: the problem is with
    // the form's own combination of fields, and the API would answer 422 with
    // a message about an Analysis the reader never saw.
    return finishCreation(back, {
      ok: false,
      failure: {
        code: "BAD_REQUEST",
        status: 400,
        reason: null,
        message: built.problem,
      },
    });
  }

  const width = integer(form, "width");
  const client = await clientForCaller();
  return finishCreation(
    back,
    await attempt(
      client.tiles.add({
        dashboardId,
        // Naming a tile before seeing it was the last question on every
        // builder, and the answer was always what the tile shows.
        title: title === "" ? titleFor(draft) : title,
        project: text(form, "project"),
        analysis: built.analysis,
        view: built.view,
        width: width ?? (built.view === "number" ? 3 : 6),
      }),
    ),
  );
};

export const addInsight = async (form: FormData): Promise<Failure | null> => {
  let extras: ReturnType<typeof analysisExtras>;
  try { extras = analysisExtras(form); }
  catch { return {code: "BAD_REQUEST", status: 400, reason: null, message: "Check the insight filters and funnel steps."}; }
  return addFromDraft(
    form,
    {
      view: text(form, "view"),
      ...extras,
      measure: text(form, "measure"),
      events: form
        .getAll("events")
        .filter((value): value is string => typeof value === "string"),
      windowAmount: integer(form, "windowAmount"),
      windowUnit: text(form, "windowUnit"),
      grain: text(form, "grain"),
      dimension: optional(form, "dimension"),
      dimensions: form
        .getAll("dimensions")
        .filter((value): value is string => typeof value === "string"),
      splitBy: optional(form, "splitBy"),
      seriesLimit: integer(form, "seriesLimit") ?? 3,
      limit: integer(form, "limit"),
    },
    text(form, "title"),
  );
};

/**
 * A copy of a tile, beside it. The second tile on a dashboard is almost always
 * a variation of the first, so the builder is not the right tool for it: copy
 * the neighbour and change the one thing that differs.
 *
 * Read from the dashboard the console already has rather than a new route —
 * a tile carries its whole question on the wire.
 */
export const duplicateInsight = async (form: FormData): Promise<void> => {
  const dashboardId = text(form, "dashboardId");
  const tileId = text(form, "tileId");
  const back = returnTo(form, "/");

  const client = await clientForCaller();
  const board = await attempt(client.dashboards.get({ dashboardId }));
  if (!board.ok) return finish(back, board);

  const source = board.value.dashboard.tiles.find((one) => one.id === tileId);
  if (source === undefined) {
    return finish(back, {
      ok: false,
      failure: {
        code: "NOT_FOUND",
        status: 404,
        reason: null,
        message: "That insight is no longer on this dashboard.",
      },
    });
  }

  finish(
    back,
    await attempt(
      client.tiles.add({
        dashboardId,
        title: `Copy of ${source.title}`.slice(0, 200),
        project: source.project,
        analysis: source.analysis,
        view: source.view,
        width: source.width,
      }),
    ),
  );
};

/** Update the complete analysis, retaining the draft on validation or save failure. */
export const updateInsight = async (form: FormData): Promise<Failure | null> => {
  const back = returnTo(form, "/");
  const client = await clientForCaller();
  let analysis: import("../lib/analysis").Analysis | undefined;
  const raw = optional(form, "analysis");
  if (raw) {
    try {
      const { AnalysisSchema } = await import("@counted/contract");
      const parsed = AnalysisSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) throw new Error("invalid");
      analysis = parsed.data;
    } catch {
      return { code: "BAD_REQUEST", status: 400, reason: null, message: "Check the analysis definition. Every field must match the selected insight type." };
    }
  }
  const view = text(form, "view");
  return finishCreation(back, await attempt(client.tiles.update({
    dashboardId: text(form, "dashboardId"), tileId: text(form, "tileId"),
    ...(text(form, "title") ? { title: text(form, "title") } : {}),
    ...(["number", "line", "bar", "table", "funnel"].includes(view) ? { view: view as import("../lib/analysis").InsightView } : {}),
    ...(analysis ? { analysis } : {}),
  })));
};

export const resizeInsight = async (form: FormData): Promise<void> => {
  const width = integer(form, "width");
  const back = returnTo(form, "/");
  if (width === null || width < 1 || width > 12) {
    return finish(back, {
      ok: false,
      failure: {
        code: "BAD_REQUEST",
        status: 400,
        reason: "InvalidWidth",
        message: "An insight's width is between 1 and 12 twelfths.",
      },
    });
  }
  const client = await clientForCaller();
  finish(
    back,
    await attempt(
      client.tiles.resize({
        dashboardId: text(form, "dashboardId"),
        tileId: text(form, "tileId"),
        width,
      }),
    ),
  );
};

/**
 * Move takes a destination index, and the buttons on the page compute it from
 * the tile's current position. Sending a direction instead would put the
 * ordering rule in two places — here and in the domain — and they would not
 * stay the same.
 */
export const moveInsight = async (form: FormData): Promise<void> => {
  const index = integer(form, "index");
  const back = returnTo(form, "/");
  if (index === null || index < 0) {
    return finish(back, {
      ok: false,
      failure: {
        code: "BAD_REQUEST",
        status: 400,
        reason: "IndexOutOfRange",
        message: "That position is not on this dashboard.",
      },
    });
  }
  const client = await clientForCaller();
  finish(
    back,
    await attempt(
      client.tiles.move({
        dashboardId: text(form, "dashboardId"),
        tileId: text(form, "tileId"),
        index,
      }),
    ),
  );
};

export const removeInsight = async (form: FormData): Promise<void> => {
  const client = await clientForCaller();
  finish(
    returnTo(form, "/"),
    await attempt(
      client.tiles.remove({
        dashboardId: text(form, "dashboardId"),
        tileId: text(form, "tileId"),
      }),
    ),
  );
};

/** Save the grid as one API mutation; keep the draft visible when it is refused. */
export const saveInsightLayout = async (
  workspaceId: string,
  input: import("../lib/client").ContractInputs["dashboards"]["layout"],
): Promise<Failure | null> => {
  const client = await clientForCaller();
  return finishCreation(`/w/${encodeURIComponent(workspaceId)}/dashboards/${encodeURIComponent(input.dashboardId)}`,
    await attempt(client.dashboards.layout(input)));
};

function analysisExtras(form: FormData): Pick<Draft, "where" | "funnelSteps" | "conversionMinutes"> {
  return {
      ...(optional(form, "where") ? { where: JSON.parse(text(form, "where")) } : {}),
      ...(optional(form, "funnelSteps") ? { funnelSteps: JSON.parse(text(form, "funnelSteps")) } : {}),
      conversionMinutes: integer(form, "conversionMinutes") ?? 30,
    };
}
