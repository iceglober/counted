"use client";

import { useState } from "react";
import { AGENT_PROMPT } from "@/lib/agent-prompt";

export function AgentPrompt() {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="px-6 max-w-2xl mx-auto pb-20">
      <div className="text-center mb-6">
        <p className="text-xs font-medium tracking-[0.15em] uppercase text-accent">Set it up with your agent</p>
        <h2 className="mt-2 font-display text-2xl md:text-3xl tracking-tight">
          Give this to your coding agent
        </h2>
        <p className="mt-3 text-text-secondary max-w-md mx-auto leading-relaxed">
          Paste it into Claude Code, Cursor, or any agent. It instruments your app and
          spins up a live dashboard with real events — no signup.
        </p>
      </div>

      {/* Action-shaped card: accent frame + a real primary Copy button so it reads
          as the thing to do, not a code sample. */}
      <div className="border border-accent/30 bg-surface-1 rounded-xl overflow-hidden shadow-[0_1px_0_0_var(--color-accent)/10]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-2/40">
          <span className="text-xs font-mono text-text-tertiary">the prompt</span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(AGENT_PROMPT);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="px-3 py-1.5 text-xs font-medium bg-accent text-surface-0 rounded-md hover:bg-accent-hover transition-colors"
          >
            {copied ? "Copied!" : "Copy prompt"}
          </button>
        </div>

        <div className={`relative ${expanded ? "" : "max-h-44 overflow-hidden"}`}>
          <pre className="px-5 py-5 text-xs leading-relaxed font-mono text-text-secondary whitespace-pre-wrap">
            {AGENT_PROMPT}
          </pre>
          {!expanded && (
            <div className="absolute bottom-0 inset-x-0 h-16 bg-gradient-to-t from-surface-1 to-transparent" />
          )}
        </div>

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
