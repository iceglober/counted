"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { BreakdownItem } from "@/lib/types";

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

// Density tiers, roomiest first. The list shrinks tier by tier until the items
// fit the card; if even the densest tier overflows, the list scrolls.
// Pixel math per item: label row (16px) + label margin + bar height, plus the
// inter-item gap — keep in sync with the Tailwind classes.
const TIERS = [
  { itemPx: 28, gapPx: 10, list: "space-y-2.5", label: "mb-1", bar: "h-2" },
  { itemPx: 24, gapPx: 6, list: "space-y-1.5", label: "mb-0.5", bar: "h-1.5" },
  { itemPx: 22, gapPx: 4, list: "space-y-1", label: "mb-0.5", bar: "h-1" },
] as const;

function pickTier(count: number, availablePx: number): { tier: (typeof TIERS)[number]; overflows: boolean } {
  for (const tier of TIERS) {
    if (count * tier.itemPx + (count - 1) * tier.gapPx <= availablePx) {
      return { tier, overflows: false };
    }
  }
  return { tier: TIERS[TIERS.length - 1], overflows: true };
}

export function Breakdown({ title, items = [] }: { title: string; items: BreakdownItem[] }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [listH, setListH] = useState(0);
  const [moreBelow, setMoreBelow] = useState(false);

  const updateScrollHint = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => {
      setListH(el.clientHeight);
      updateScrollHint();
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateScrollHint, items.length]);

  if (items.length === 0) {
    return (
      <div className="w-full bg-surface-1 border border-border rounded-lg p-5">
        <div className="text-xs text-text-secondary uppercase tracking-wider mb-3">{title}</div>
        <div className="h-32 flex items-center justify-center text-text-tertiary text-sm">No data yet</div>
      </div>
    );
  }

  const max = Math.max(...items.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0);
  const { tier, overflows } = pickTier(items.length, listH);

  return (
    <div className="w-full h-full flex flex-col bg-surface-1 border border-border rounded-lg p-5 hover:border-border-hover transition-colors">
      <div className="flex items-baseline justify-between mb-4 shrink-0">
        <div className="text-xs text-text-secondary uppercase tracking-wider">{title}</div>
        <div className="text-sm font-semibold tabular-nums">{fmt(total)}</div>
      </div>
      <div className="relative flex-1 min-h-0">
        <div
          ref={listRef}
          onScroll={updateScrollHint}
          className={`h-full ${tier.list} ${overflows ? "overflow-y-auto" : "overflow-hidden"}`}
        >
          {items.map((item, i) => {
            const pct = total > 0 ? (item.value / total) * 100 : 0;
            const barPct = max > 0 ? (item.value / max) * 100 : 0;
            return (
              <div key={item.label} className="group">
                <div className={`flex items-center justify-between text-sm ${tier.label}`}>
                  <span className="text-text-primary text-xs truncate">{item.label ?? "unknown"}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-text-tertiary tabular-nums text-xs">{pct.toFixed(1)}%</span>
                    <span className="text-text-secondary tabular-nums text-xs font-medium">{fmt(item.value)}</span>
                  </div>
                </div>
                <div className={`${tier.bar} bg-surface-2 rounded-full overflow-hidden`}>
                  <div
                    className="h-full origin-left rounded-full bg-gradient-to-r from-accent/45 to-accent transition-[filter] duration-200 animate-grow-x group-hover:brightness-110"
                    style={{ width: `${barPct}%`, animationDelay: `${i * 55}ms` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {/* Fade hints that more rows are below the fold. */}
        {moreBelow && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface-1 to-transparent" />
        )}
      </div>
    </div>
  );
}
