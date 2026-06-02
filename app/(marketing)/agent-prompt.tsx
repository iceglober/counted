"use client";

import { useState } from "react";
import { AGENT_PROMPT } from "@/lib/agent-prompt";

export function AgentPrompt() {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="px-6 max-w-2xl mx-auto pb-20">
      <div className="text-center mb-4">
        <h2 className="font-display text-2xl tracking-tight">Give this to your coding agent</h2>
        <p className="text-sm text-text-secondary mt-2">
          Paste it into Claude Code, Cursor, or any agent. A live dashboard with real
          events in minutes — no signup.
        </p>
      </div>

      <div className="relative bg-surface-1 border border-border rounded-lg">
        <div className={`relative ${expanded ? "" : "max-h-48 overflow-hidden"}`}>
          <pre className="px-5 py-5 text-xs leading-relaxed font-mono text-text-secondary whitespace-pre-wrap pr-16">
            {AGENT_PROMPT}
          </pre>
          {!expanded && (
            <div className="absolute bottom-0 inset-x-0 h-16 bg-gradient-to-t from-surface-1 to-transparent" />
          )}
        </div>

        <button
          onClick={() => {
            navigator.clipboard.writeText(AGENT_PROMPT);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="absolute top-3 right-3 px-2.5 py-1 text-xs bg-surface-2 border border-border rounded text-text-tertiary hover:text-text-primary transition-colors"
        >
          {copied ? "Copied!" : "Copy"}
        </button>

        <button
          onClick={() => setExpanded((e) => !e)}
          className="w-full px-5 py-2 text-xs text-text-tertiary hover:text-text-primary border-t border-border transition-colors"
        >
          {expanded ? "Show less" : "Show full prompt"}
        </button>
      </div>
    </section>
  );
}
