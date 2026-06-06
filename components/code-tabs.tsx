"use client";

import { useEffect, useState } from "react";

export type CodeTab = { label: string; lang: string; code: string };

// Sticky language choice, shared across every CodeTabs on the page (switch one →
// all switch). Stored in first-party localStorage (a non-identifying preference,
// not a tracking cookie) and synced live via a window event.
const STORAGE_KEY = "counted_codelang";
const SYNC_EVENT = "counted-codelang";

export function CodeTabs({ tabs }: { tabs: CodeTab[] }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const apply = (lang: string | null) => {
      if (!lang) return;
      const i = tabs.findIndex((t) => t.lang === lang);
      if (i >= 0) setActive(i);
    };
    try {
      apply(localStorage.getItem(STORAGE_KEY));
    } catch {
      /* private mode */
    }
    const onSync = (e: Event) => apply((e as CustomEvent<string>).detail);
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, [tabs]);

  function choose(i: number) {
    setActive(i);
    try {
      localStorage.setItem(STORAGE_KEY, tabs[i].lang);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: tabs[i].lang }));
  }

  const current = tabs[active] ?? tabs[0];

  return (
    <div className="rounded-xl border border-accent/30 bg-surface-1 overflow-hidden">
      <div className="flex items-center gap-1 border-b border-border bg-surface-2/40 px-2 py-1.5 overflow-x-auto">
        {tabs.map((t, i) => (
          <button
            key={t.lang}
            type="button"
            onClick={() => choose(i)}
            className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              i === active
                ? "bg-accent/15 text-accent"
                : "text-text-tertiary hover:text-text-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <pre className="text-left px-5 py-4 text-xs md:text-sm font-mono text-text-secondary overflow-x-auto leading-relaxed whitespace-pre">
        {current?.code}
      </pre>
    </div>
  );
}
