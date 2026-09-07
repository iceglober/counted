"use client";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import GridLayout, { useContainerWidth, type Layout } from "react-grid-layout";
import {
  IconGripVertical,
  IconArrowsDiagonal,
  IconLayoutGrid,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconInfoCircle,
} from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import { Checkbox } from "@counted/ui/components/checkbox";
import { Skeleton } from "@counted/ui/components/skeleton";
import {
  Card,
  CardContent,
  CardAction,
  CardHeader,
  CardTitle,
} from "@counted/ui/components/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@counted/ui/components/popover";
import { Alert, AlertDescription } from "@counted/ui/components/alert";
import type { ContractOutputs } from "../lib/client";
import { sentenceFor } from "../lib/failure";
import {
  adjustLayout,
  applyMobileLayout,
  insightCompactor,
  packInsights,
  packInteractiveLayout,
  insightLayout,
  moveMobileInsight,
  layoutOrder,
  mobileLayout,
  placementsOf,
  GRID_GAP,
  GRID_ROW_HEIGHT,
} from "../lib/insight-layout";
import { saveInsightLayout } from "../actions/insights";
import { InsightControls } from "./insight-controls";
import { ReadoutBody } from "./readout";
import { Empty } from "./notice";

type Dashboard = ContractOutputs["dashboards"]["get"]["dashboard"];
type Readout = ContractOutputs["dashboards"]["readouts"]["readouts"][number];

export function InsightGrid({
  dashboard,
  readouts,
  workspaceId,
  projects = [],
}: {
  dashboard: Dashboard;
  readouts: readonly Readout[];
  workspaceId?: string;
  projects?: ContractOutputs["projects"]["list"]["items"];
}) {
  const { width, containerRef, mounted } = useContainerWidth({
    measureBeforeMount: true,
  });
  const heldInsight = useRef<string | undefined>(undefined);
  const heldLayout = useRef<Layout | undefined>(undefined);
  const interactiveCompactor = useMemo(
    () => ({
      ...insightCompactor,
      compact: (layout: Layout, cols: number) =>
        packInteractiveLayout(
          layout,
          cols,
          heldLayout.current,
          heldInsight.current,
        ),
    }),
    [],
  );
  const [draft, setDraft] = useState<Layout>(() =>
    insightLayout(dashboard.tiles),
  );
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [refreshing, refreshTransition] = useTransition();
  const [automatic, setAutomatic] = useState(false);
  const refresh = () => refreshTransition(() => router.refresh());
  useEffect(() => {
    if (!automatic || editing) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") refreshTransition(() => router.refresh()); }, 60_000);
    return () => clearInterval(timer);
  }, [automatic, editing, router]);
  const latest = readouts.flatMap((one) => one.ok ? [one.computedAt] : []).sort().at(-1);
  const saved = insightLayout(dashboard.tiles);
  const current = editing ? draft : saved;
  const narrow = !mounted || width < 720;
  const shown = narrow ? mobileLayout(current) : current;
  const dirty =
    JSON.stringify(placementsOf(draft)) !== JSON.stringify(placementsOf(saved));
  const byId = new Map(dashboard.tiles.map((tile) => [tile.id, tile]));
  const byReadout = new Map(readouts.map((readout) => [readout.tile, readout]));
  const here = `/w/${workspaceId}/dashboards/${dashboard.id}`;
  const change = (next: Layout) => {
    heldInsight.current = undefined;
    heldLayout.current = undefined;
    const packed = packInsights(next, narrow ? 1 : 12);
    if (!narrow) setDraft(packed);
    else setDraft(applyMobileLayout(current, packed));
    setStatus("Layout changed. Save when you’re ready.");
  };
  const save = () =>
    startTransition(async () => {
      if (!workspaceId) return;
      setError(undefined);
      try {
        const failure = await saveInsightLayout(workspaceId, {
          dashboardId: dashboard.id,
          placements: placementsOf(draft),
        });
        if (failure) {
          setError(sentenceFor(failure));
          return;
        }
        setEditing(false);
        setStatus("Layout saved.");
        router.refresh();
      } catch {
        setError(
          "The layout could not be saved. Your changes are still here; try again.",
        );
      }
    });
  return (
    <section className="min-w-0 space-y-4" aria-label="Dashboard insights">
      {(
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {editing
              ? narrow
                ? "Drag to arrange. Pull the bottom edge to resize."
                : "Drag to arrange. Pull a corner to resize."
              : status || (latest ? `Updated ${new Date(latest).toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit", timeZone: "UTC"})} UTC` : "No readings available")}
          </p>
          <div className="ml-auto flex flex-wrap gap-2">
            {!editing && <><label className="flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={automatic} onCheckedChange={(value) => setAutomatic(value === true)} />Live · 1 min</label><Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing}><IconRefresh aria-hidden="true" />{refreshing ? "Refreshing…" : "Refresh"}</Button></>}
            {workspaceId && (editing ? (
              <>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setEditing(false);
                    setError(undefined);
                    setStatus("");
                  }}
                >
                  Cancel
                </Button>
                <Button disabled={pending || !dirty} onClick={save}>
                  {pending ? "Saving…" : "Save layout"}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(saved);
                  setEditing(true);
                  setStatus("");
                }}
              >
                <IconLayoutGrid aria-hidden="true" />
                Edit layout
              </Button>
            ))}
          </div>
        </div>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <p id="grid-keyboard-help" className="sr-only">
        Use a move handle’s arrow keys to rearrange an insight. Use its Size and
        position button for step controls.
      </p>
      <div
        ref={containerRef}
        className={`insight-grid min-w-0 ${editing ? "is-editing" : ""}`}
      >
        {mounted ? (
          <GridLayout
            width={width}
            layout={shown}
            compactor={interactiveCompactor}
            gridConfig={{
              cols: narrow ? 1 : 12,
              rowHeight: GRID_ROW_HEIGHT,
              margin: [GRID_GAP, GRID_GAP],
              containerPadding: [0, 0],
            }}
            dragConfig={{
              enabled: editing && !pending,
              handle: ".insight-drag-handle",
              threshold: 4,
            }}
            resizeConfig={{
              enabled: editing && !pending,
              handles: narrow ? ["s"] : ["se", "e", "s"],
            }}
            onDragStart={(layout, _oldItem, item) => {
              heldInsight.current = item?.i;
              heldLayout.current = layout.map((one) => ({ ...one }));
            }}
            onResizeStart={(layout, _oldItem, item) => {
              heldInsight.current = item?.i;
              heldLayout.current = layout.map((one) => ({ ...one }));
            }}
            onDragStop={(layout) => change(layout)}
            onResizeStop={(layout) => change(layout)}
          >
            {layoutOrder(shown).map((item) => {
              const tile = byId.get(item.i)!;
              const real = current.find((one) => one.i === item.i)!;
              const readout = byReadout.get(item.i);
              const adjust = (
                patch: Partial<Pick<typeof real, "x" | "y" | "w" | "h">>,
              ) => {
                setDraft(
                  narrow
                    ? patch.y !== undefined
                      ? moveMobileInsight(
                          current,
                          item.i,
                          patch.y < real.y ? -1 : 1,
                        )
                      : applyMobileLayout(
                          current,
                          mobileLayout(current).map((one) =>
                            one.i === item.i
                              ? { ...one, h: patch.h ?? one.h }
                              : one,
                          ),
                        )
                    : adjustLayout(current, item.i, patch),
                );
                setStatus("Layout changed. Save when you’re ready.");
              };
              return (
                <div
                  key={tile.id}
                  data-insight-id={tile.id}
                  className="min-h-0 min-w-0"
                >
                  <Card
                    className="insight-card h-full min-h-0 gap-3"
                    data-editing={editing}
                  >
                    <CardHeader className="shrink-0 gap-2">
                      <CardTitle
                        role="heading"
                        aria-level={2}
                        className="line-clamp-2 text-base leading-snug"
                        title={tile.title}
                      >
                        {tile.title}
                      </CardTitle>
                      <CardAction className="flex gap-0.5">
                        {!editing && <Popover><PopoverTrigger render={<Button variant="ghost" size="icon-sm" />} aria-label={`About insight: ${tile.title}`}><IconInfoCircle aria-hidden="true" /></PopoverTrigger><PopoverContent align="end" className="w-72 space-y-3 text-sm"><p className="font-medium">{tile.title}</p><dl className="space-y-2"><div><dt className="text-xs text-muted-foreground">Project</dt><dd className="break-words">{projects.find((one) => one.id === tile.project)?.name ?? tile.project}</dd></div><div><dt className="text-xs text-muted-foreground">Period</dt><dd>{periodFor(tile.analysis)}</dd></div><div><dt className="text-xs text-muted-foreground">Last reading</dt><dd>{readout?.ok ? new Date(readout.computedAt).toLocaleString("en-US", {timeZone: "UTC"}) + " UTC" : "Unavailable"}</dd></div></dl></PopoverContent></Popover>}

                        {editing ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="insight-drag-handle touch-none cursor-grab active:cursor-grabbing"
                              aria-label={`Move ${tile.title}`}
                              aria-describedby="grid-keyboard-help"
                              disabled={pending}
                              onKeyDown={(event) => {
                                const delta = {
                                  ArrowLeft: { x: real.x - 1 },
                                  ArrowRight: { x: real.x + 1 },
                                  ArrowUp: { y: real.y - 1 },
                                  ArrowDown: { y: real.y + 1 },
                                }[event.key];
                                if (
                                  delta &&
                                  (!narrow ||
                                    event.key === "ArrowUp" ||
                                    event.key === "ArrowDown")
                                ) {
                                  event.preventDefault();
                                  adjust(delta);
                                }
                              }}
                            >
                              <IconGripVertical aria-hidden="true" />
                            </Button>
                            <Popover>
                              <PopoverTrigger
                                render={
                                  <Button variant="ghost" size="icon-sm" />
                                }
                                aria-label={`Size and position: ${tile.title}`}
                                disabled={pending}
                              >
                                <IconArrowsDiagonal aria-hidden="true" />
                              </PopoverTrigger>
                              <PopoverContent
                                align="end"
                                className="w-64 space-y-4"
                              >
                                <p className="font-medium">Size and position</p>
                                {[
                                  {
                                    label: "Width",
                                    value: real.w,
                                    field: "w",
                                    min: real.minW ?? 1,
                                    max: 12,
                                  },
                                  {
                                    label: "Height",
                                    value: real.h,
                                    field: "h",
                                    min: real.minH ?? 3,
                                    max: 20,
                                  },
                                ]
                                  .filter(
                                    ({ field }) => !narrow || field === "h",
                                  )
                                  .map(({ label, value, field, min, max }) => (
                                    <div
                                      key={field}
                                      className="flex items-center justify-between gap-3"
                                    >
                                      <span>{label}</span>
                                      <div className="flex items-center gap-2">
                                        <Button
                                          size="icon-sm"
                                          variant="outline"
                                          aria-label={`Decrease ${label.toLowerCase()}`}
                                          disabled={value <= min}
                                          onClick={() =>
                                            adjust({ [field]: value - 1 })
                                          }
                                        >
                                          <IconMinus aria-hidden="true" />
                                        </Button>
                                        <output className="w-5 text-center tabular-nums">
                                          {value}
                                        </output>
                                        <Button
                                          size="icon-sm"
                                          variant="outline"
                                          aria-label={`Increase ${label.toLowerCase()}`}
                                          disabled={value >= max}
                                          onClick={() =>
                                            adjust({ [field]: value + 1 })
                                          }
                                        >
                                          <IconPlus aria-hidden="true" />
                                        </Button>
                                      </div>
                                    </div>
                                  ))}
                                <div className="grid grid-cols-2 gap-2">
                                  {[
                                    { label: "Left", x: real.x - 1 },
                                    { label: "Right", x: real.x + 1 },
                                    { label: "Up", y: real.y - 1 },
                                    { label: "Down", y: real.y + 1 },
                                  ]
                                    .filter(
                                      ({ label }) =>
                                        !narrow ||
                                        label === "Up" ||
                                        label === "Down",
                                    )
                                    .map(({ label, ...patch }) => (
                                      <Button
                                        key={label}
                                        size="sm"
                                        variant="outline"
                                        disabled={
                                          (label === "Left" && real.x === 0) ||
                                          (label === "Right" &&
                                            real.x + real.w === 12) ||
                                          (label === "Up" &&
                                            (narrow
                                              ? layoutOrder(current)[0]?.i ===
                                                item.i
                                              : real.y === 0)) ||
                                          (narrow &&
                                            label === "Down" &&
                                            layoutOrder(current).at(-1)?.i ===
                                              item.i)
                                        }
                                        onClick={() => adjust(patch)}
                                      >
                                        {label}
                                      </Button>
                                    ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                          </>
                        ) : workspaceId ? (
                          <InsightControls
                            tile={tile}
                            dashboardId={dashboard.id}
                            returnTo={here}
                            projects={projects}
                          />
                        ) : null}
                      </CardAction>
                    </CardHeader>
                    <CardContent className="min-h-0 flex-1 overflow-hidden">
                      {readout ? (
                        <ReadoutBody
                          readout={readout}
                          label={tile.title}
                          view={tile.view}
                          analysis={tile.analysis}
                          fill
                        />
                      ) : (
                        <Empty>No reading was returned for this insight.</Empty>
                      )}
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </GridLayout>
        ) : (
          <div
            role="status"
            aria-label="Loading dashboard layout"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            {dashboard.tiles.slice(0, 4).map((tile) => (
              <Skeleton key={tile.id} className="h-38 w-full" />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function periodFor(analysis: Dashboard["tiles"][number]["analysis"]): string {
  const window = analysis.shape === "funnel" ? analysis.funnel.window : analysis.window;
  return window.kind === "relative" ? `Last ${window.amount} ${window.unit}${window.amount === 1 ? "" : "s"}` : `${window.from} – ${window.to}`;
}
