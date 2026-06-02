"use client";

import { useState } from "react";

const PROMPT =
  "Read https://counted.dev/docs/llms.txt, then add Counted analytics to this " +
  "project: explore the codebase, instrument the highest-signal user actions, " +
  "and provision a key (no signup needed). Then give me the claim link so I can " +
  "open my live dashboard with real events.";

export function AgentPrompt() {
  const [copied, setCopied] = useState(false);

  return (
    <section className="px-6 max-w-2xl mx-auto pb-20">
      <div className="text-center mb-4">
        <h2 className="font-display text-2xl tracking-tight">Give this to your coding agent</h2>
        <p className="text-sm text-text-secondary mt-2">
          Paste it into Claude Code, Cursor, or any agent. A live dashboard with real
          events in minutes — no signup.
        </p>
      </div>
      <div className="relative bg-surface-1 border border-border rounded-lg p-5">
        <p className="text-sm text-text-secondary leading-relaxed pr-12 font-mono">{PROMPT}</p>
        <button
          onClick={() => {
            navigator.clipboard.writeText(PROMPT);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="absolute top-3 right-3 px-2.5 py-1 text-xs bg-surface-2 border border-border rounded text-text-tertiary hover:text-text-primary transition-colors"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </section>
  );
}
