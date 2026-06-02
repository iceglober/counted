"use client";

import { useState, useEffect } from "react";
import { Check, Copy } from "lucide-react";

type Props = {
  projectKey: string;
  projectId: string;
};

const TABS = [
  { id: "claude", label: "Claude Code" },
  { id: "opencode", label: "OpenCode" },
] as const;

function Snippet({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start justify-between gap-2 bg-surface-2 border border-border rounded-md px-3 py-2">
      <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-all">{text}</pre>
      <button
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label="Copy"
        className="shrink-0 text-text-tertiary hover:text-text-primary transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-accent" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

/**
 * Setup card for the agent-eval dashboard: shows how to install the native
 * plugin for Claude Code / OpenCode and polls for the first event. Renders only
 * until events arrive (then a dismissible success bar).
 */
export function AgentSetup({ projectKey, projectId }: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("claude");
  const [eventCount, setEventCount] = useState(0);

  useEffect(() => {
    if (eventCount > 0) return;
    const poll = async () => {
      try {
        const res = await fetch("/api/v0/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            query: { measure: "count" },
            timeRange: { type: "relative", value: 24, unit: "hours" },
          }),
        });
        if (res.ok) {
          const { data } = await res.json();
          setEventCount(Number(data?.[0]?.value ?? 0));
        }
      } catch {}
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [projectId, eventCount]);

  // Once events arrive the setup card just disappears — the live "N events · 24h"
  // count next to the dashboard title is the ongoing connected indicator.
  if (eventCount > 0) return null;

  return (
    <div className="mb-6 bg-surface-1 border border-border rounded-lg p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold">Connect your coding agent</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            Install the native plugin — agent sessions stream in privately (no code or prompts leave your machine).
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
          <span className="w-1.5 h-1.5 rounded-full bg-accent/40 animate-pulse" />
          Waiting for first event…
        </span>
      </div>

      <div className="flex gap-1.5 mt-4 mb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
              tab === t.id
                ? "bg-accent/15 text-accent border border-accent/30"
                : "bg-surface-2 text-text-secondary border border-transparent hover:text-text-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "claude" ? (
        <div className="space-y-2">
          <p className="text-xs text-text-secondary">In Claude Code, install the plugin:</p>
          <Snippet text={"/plugin marketplace add iceglober/counted\n/plugin install claude-code@counted"} />
          <p className="text-xs text-text-secondary mt-2">Paste your project key when prompted:</p>
          <Snippet text={projectKey} />
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-text-secondary">Add the plugin to your <span className="font-mono">opencode.json</span>:</p>
          <Snippet text={'{\n  "plugin": ["@counted/opencode"]\n}'} />
          <p className="text-xs text-text-secondary mt-2">Then set your project key:</p>
          <Snippet text={`export COUNTED_AGENT_KEY="${projectKey}"`} />
        </div>
      )}
    </div>
  );
}
