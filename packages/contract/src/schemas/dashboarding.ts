/**
 * Dashboard, tile, share and monitor shapes.
 *
 * `width` is in twelfths, once. v1 had three width vocabularies — a CSS class,
 * a fraction and a column count — and a tile that was `half` in the database
 * rendered at a third on the page.
 */

import * as z from "zod";
import {
  DashboardIdSchema,
  DurationMsSchema,
  InstantSchema,
  MonitorIdSchema,
  ProjectIdSchema,
  TileIdSchema,
  WorkspaceIdSchema,
} from "../primitives";
import { AnalysisSchema } from "./analysis";

export const TileViewSchema = z.enum(["number", "line", "bar", "table", "funnel", "retention"]);

/** Twelfths of a row. The only width vocabulary there is. */
export const TileWidthSchema = z.int().min(1).max(12);

export const TileLayoutSchema = z.object({
  x: z.int().min(0).max(11),
  y: z.int().min(0).max(1000),
  height: z.int().min(3).max(20),
}).meta({ id: "TileLayout", description: "Position and height in grid units. Width remains in twelfths." });
export const TilePlacementSchema = TileLayoutSchema.extend({ id: TileIdSchema, width: TileWidthSchema });

/**
 * A tile names its own project. A dashboard can therefore show two products
 * side by side, and a share link's reach is exactly the set of projects its
 * tiles name — derived, never configured separately.
 */
export const TileSchema = z
  .object({
    id: TileIdSchema,
    title: z.string(),
    project: ProjectIdSchema,
    analysis: AnalysisSchema,
    view: TileViewSchema,
    width: TileWidthSchema,
    layout: TileLayoutSchema.nullable().optional(),
  })
  .meta({ id: "Tile", description: "One question on a dashboard." });

/**
 * What a share link is, without the token. The token exists once, at creation;
 * afterwards the console can say a link is live and when it lapses, and cannot
 * recover it — which is why revoking and re-sharing is the only way to get a
 * URL back.
 */
export const ShareStateSchema = z
  .object({ expiresAt: InstantSchema })
  .meta({ id: "ShareState", description: "A live share link's expiry." });

export const ShareLinkSchema = z
  .object({
    token: z.string().describe("Shown once, at creation. Counted stores only its digest."),
    expiresAt: InstantSchema,
  })
  .meta({ id: "ShareLink", description: "A newly created share link." });

export const DashboardSchema = z
  .object({
    id: DashboardIdSchema,
    workspace: WorkspaceIdSchema,
    name: z.string(),
    tiles: z.array(TileSchema),
    isDefault: z.boolean(),
    share: ShareStateSchema.nullable(),
  })
  .meta({ id: "Dashboard", description: "A dashboard and its insights, in order." });

export const DashboardSummarySchema = z
  .object({
    id: DashboardIdSchema,
    workspace: WorkspaceIdSchema,
    name: z.string(),
    tileCount: z.int(),
    shared: z.boolean(),
    isDefault: z.boolean(),
  })
  .meta({ id: "DashboardSummary", description: "A dashboard in a list." });

/** Strict on both sides: `above 10` is not breached by exactly 10. */
export const ThresholdSchema = z
  .object({ comparison: z.enum(["above", "below"]), value: z.number() })
  .meta({ id: "Threshold", description: "When a monitor is in breach." });

export const ChannelSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("email"), address: z.email() }),
    z.object({ kind: z.literal("webhook"), url: z.url() }),
  ])
  .meta({ id: "Channel", description: "Where a firing monitor is announced." });

export const MonitorSchema = z
  .object({
    id: MonitorIdSchema,
    workspace: WorkspaceIdSchema,
    project: ProjectIdSchema,
    name: z.string(),
    analysis: AnalysisSchema,
    threshold: ThresholdSchema,
    /**
     * How long a monitor stays quiet while still in breach. v1 hardcoded an
     * hour; "tell me every five minutes" and "tell me daily" are different
     * products.
     */
    cooldownMs: DurationMsSchema,
    channels: z.array(ChannelSchema),
    enabled: z.boolean(),
    state: z.enum(["ok", "breaching"]),
    lastNotifiedAt: InstantSchema.nullable().describe("When a breach notice was queued; lastDeliveredAt confirms transport acceptance."),
    lastValue: z.number().nullable(),
    lastAttemptAt: InstantSchema.nullable(),
    lastMeasuredAt: InstantSchema.nullable(),
    evaluationError: z.string().nullable(),
    pendingDeliveries: z.number().int().nonnegative(),
    failedDeliveries: z.number().int().nonnegative(),
    deliveryError: z.string().nullable(),
    lastDeliveredAt: InstantSchema.nullable(),
  })
  .meta({ id: "Monitor", description: "A scalar question watched against a threshold." });
