import {
  collides,
  verticalCompactor,
  type Compactor,
  type Layout,
  type LayoutItem,
} from "react-grid-layout";
import type { ContractOutputs } from "./client";

type Insight =
  ContractOutputs["dashboards"]["get"]["dashboard"]["tiles"][number];
export const GRID_ROW_HEIGHT = 40;
export const GRID_GAP = 16;

/** Existing dashboards flow into a grid; chosen sizes survive packing toward the upper-left. */
export function insightLayout(tiles: readonly Insight[]): LayoutItem[] {
  const placed: LayoutItem[] = [];
  for (const tile of tiles) {
    const minH = tile.view === "number" ? 3 : 5;
    const item: LayoutItem = {
      i: tile.id,
      x: tile.layout?.x ?? 0,
      y: tile.layout?.y ?? 0,
      w: tile.width,
      h: tile.layout?.height ?? (tile.view === "number" ? 3 : 6),
      minW: tile.view === "number" ? 2 : 3,
      minH,
      maxW: 12,
      maxH: 20,
    };
    item.h = Math.max(minH, item.h);
    if (!tile.layout || placed.some((other) => collides(item, other))) {
      item.y = 0;
      search: for (; item.y <= 1000; item.y++) {
        for (item.x = 0; item.x <= 12 - item.w; item.x++) {
          if (!placed.some((other) => collides(item, other))) break search;
        }
      }
    }
    placed.push(item);
  }
  return [...insightCompactor.compact(placed, 12)];
}

export const layoutOrder = (layout: Layout) =>
  [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
export const placementsOf = (layout: Layout) =>
  layoutOrder(layout).map(({ i, x, y, w, h }) => ({
    id: i,
    x,
    y,
    width: w,
    height: h,
  }));

/** Moving and resizing with buttons uses the same collision-free grid as dragging. */
export function adjustLayout(
  layout: Layout,
  id: string,
  patch: Partial<Pick<LayoutItem, "x" | "y" | "w" | "h">>,
): LayoutItem[] {
  const items = layout.map((item) => ({ ...item }));
  const item = items.find((item) => item.i === id)!;
  Object.assign(item, patch);
  item.w = Math.max(item.minW ?? 1, Math.min(12, item.w));
  item.h = Math.max(item.minH ?? 3, Math.min(20, item.h));
  item.x = Math.max(0, Math.min(12 - item.w, item.x));
  item.y = Math.max(0, Math.min(1000, item.y));
  const pending = [item];
  while (pending.length) {
    const changed = pending.shift()!;
    for (const other of items) {
      if (other.i !== changed.i && collides(changed, other)) {
        other.y = changed.y + changed.h;
        pending.push(other);
      }
    }
  }
  return packInsights(
    packInsights(
      items,
      12,
      id,
      layoutOrder(layout).map((one) => one.i),
    ),
    12,
  );
}

/** A phone's single column never overwrites desktop widths or positions on a viewport change. */
export function mobileLayout(layout: Layout): LayoutItem[] {
  let y = 0;
  return layoutOrder(layout).map((item) => {
    const mobile = { ...item, x: 0, y, w: 1, minW: 1, maxW: 1 };
    y += item.h;
    return mobile;
  });
}

/**
 * Fill the earliest available rectangle, searching rows before columns. Every
 * move decreases (y, x), so settling terminates and repeating it is stable.
 * Consider all other cards as occupied: fitting a short card into a tall row's
 * gap must never overlap the row below it.
 *
 * Hold the card under the pointer while neighbors fill the space it vacated.
 * Releasing it settles the complete layout, including that card.
 */
export function packInsights(
  layout: Layout,
  cols: number,
  heldId?: string,
  order?: readonly string[],
): LayoutItem[] {
  const held = layout.find((item) => item.i === heldId);
  const items = [
    ...verticalCompactor.compact(
      layout.map((item) =>
        item.i === heldId ? { ...item, static: true } : { ...item },
      ),
      cols,
    ),
  ];
  const priority = order
    ? new Map(order.map((id, index) => [id, index]))
    : null;
  let changed: boolean;
  do {
    changed = false;
    const settling = layoutOrder(items);
    if (priority)
      settling.sort(
        (a, b) =>
          (priority.get(a.i) ?? Infinity) - (priority.get(b.i) ?? Infinity),
      );
    for (const item of settling) {
      if (item.static) continue;
      const others = items.filter((other) => other.i !== item.i);
      const rows = [
        ...new Set([0, item.y, ...others.map((other) => other.y + other.h)]),
      ]
        .filter((y) => y <= item.y)
        .sort((a, b) => a - b);
      search: for (const y of rows) {
        for (let x = 0; x <= cols - item.w; x++) {
          if (y === item.y && x >= item.x) break;
          if (others.some((other) => collides({ ...item, x, y }, other)))
            continue;
          item.x = x;
          item.y = y;
          changed = true;
          break search;
        }
      }
    }
  } while (changed);
  if (held) {
    const item = items.find((item) => item.i === heldId)!;
    if (held.static === undefined) delete item.static;
    else item.static = held.static;
  }
  return items;
}

/** Recompute each pointer position from the starting layout, avoiding cumulative reshuffles. */
export function packInteractiveLayout(
  layout: Layout,
  cols: number,
  initial?: Layout,
  heldId?: string,
): LayoutItem[] {
  const held = layout.find((item) => item.i === heldId);
  const source =
    initial && held
      ? initial.map((item) => (item.i === held.i ? held : item))
      : layout;
  return packInsights(
    source,
    cols,
    heldId,
    initial ? layoutOrder(initial).map((item) => item.i) : undefined,
  );
}

export const insightCompactor: Compactor = {
  type: "vertical",
  allowOverlap: false,
  compact: packInsights,
};

/** A mobile edit changes order and height, while retaining desktop widths. */
export function applyMobileLayout(
  desktop: Layout,
  mobile: Layout,
): LayoutItem[] {
  let y = 0,
    x = 0,
    height = 0;
  const placed = layoutOrder(mobile).map((item) => {
    const original = desktop.find((other) => other.i === item.i)!;
    if (x + original.w > 12) {
      y += height;
      x = 0;
      height = 0;
    }
    const placed = { ...original, x, y, h: item.h };
    x += original.w;
    height = Math.max(height, item.h);
    return placed;
  });
  return [...insightCompactor.compact(placed, 12)];
}

export function moveMobileInsight(
  layout: Layout,
  id: string,
  offset: -1 | 1,
): LayoutItem[] {
  const ordered = mobileLayout(layout);
  const index = ordered.findIndex((item) => item.i === id);
  const target = index + offset;
  if (target < 0 || target >= ordered.length) return [...layout];
  [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
  return applyMobileLayout(
    layout,
    ordered.map((item, y) => ({ ...item, y })),
  );
}
