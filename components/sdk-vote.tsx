"use client";

import { useEffect, useState } from "react";
import { track } from "@/app/(marketing)/analytics";

// "+1 an upcoming SDK" — the vote is just a Counted event (sdk_vote, dogfooded),
// so demand shows up on our own Growth dashboard. One vote per SDK per browser,
// remembered in first-party localStorage (a non-identifying preference, not a
// cookie). No public counts — the signal is for our roadmap, not a leaderboard.
const UPCOMING = [
  { id: "python", label: "Python" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "swift", label: "Swift" },
  { id: "kotlin", label: "Kotlin" },
] as const;

const KEY = (id: string) => `counted_sdk_vote_${id}`;

export function SdkVote() {
  const [voted, setVoted] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const v: Record<string, boolean> = {};
      for (const s of UPCOMING) v[s.id] = localStorage.getItem(KEY(s.id)) === "1";
      setVoted(v);
    } catch {
      /* private mode */
    }
  }, []);

  function vote(id: string) {
    if (voted[id]) return;
    track("sdk_vote", { sdk: id });
    try {
      localStorage.setItem(KEY(id), "1");
    } catch {
      /* private mode — still count the event */
    }
    setVoted((v) => ({ ...v, [id]: true }));
  }

  return (
    <div className="flex flex-wrap gap-2">
      {UPCOMING.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => vote(s.id)}
          disabled={voted[s.id]}
          aria-pressed={voted[s.id]}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
            voted[s.id]
              ? "border-accent/40 bg-accent/10 text-accent cursor-default"
              : "border-border text-text-secondary hover:border-border-hover hover:text-text-primary"
          }`}
        >
          {s.label}
          <span className="text-xs font-medium">{voted[s.id] ? "✓ +1’d" : "+1"}</span>
        </button>
      ))}
    </div>
  );
}
