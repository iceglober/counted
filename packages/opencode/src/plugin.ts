// Native OpenCode plugin. Add "@counted/opencode" to your opencode.json
// "plugin" array (or drop a re-export in .opencode/plugins/). OpenCode loads
// this once per process and keeps the returned hooks for the process lifetime,
// so — unlike the Claude Code per-event subprocess — we hold one long-lived
// Analytics instance and let it batch.
//
// Privacy/safety mirrors the rest of Counted's agent integrations: no-op unless
// COUNTED_AGENT_KEY is set, tool name + outcome only, file paths repo-relative,
// commands reduced to the binary name. Never throws into the host.
import {
  init,
  trackSessionStart,
  trackToolUse,
  trackFileEdit,
  trackCommand,
  getAnalytics,
  destroy,
} from "./index";
import { setupFingerprint } from "@counted/sdk";

// Minimal structural types — the authoritative ones live in @opencode-ai/plugin.
type Hooks = Record<string, (...args: any[]) => any>;
type PluginInput = { directory?: string; worktree?: string; [k: string]: unknown };

let initialized = false;
let sessionStarted = false;
let setupRegistered = false;

// Hash a deliberate, versioned slice of the OpenCode config: model, agent/prompt
// definitions, tools/permissions, and sampling params. Register it as context so
// every event carries the setup fingerprint (only the digest leaves the machine).
function registerSetup(config: Record<string, any> | undefined) {
  if (setupRegistered || !config) return;
  if (!ensureInit()) return;
  const projection = {
    model: config.model,
    agents: config.agent ?? config.agents,
    tools: config.tools,
    permission: config.permission,
    provider: config.provider,
    sampling: {
      temperature: config.temperature,
      top_p: config.top_p,
      reasoningEffort: config.reasoningEffort ?? config.reasoning_effort,
    },
  };
  const { setupHash, setupHashVersion } = setupFingerprint(projection);
  const ctx: Record<string, string | number> = { setupHash, setupHashVersion };
  if (typeof config.model === "string") ctx.model = config.model;
  const label = process.env.COUNTED_SETUP_LABEL;
  if (label) ctx.setupLabel = label;
  getAnalytics()?.register(ctx);
  setupRegistered = true;
}

function ensureInit(): boolean {
  if (initialized) return getAnalytics() !== null;
  const key = process.env.COUNTED_AGENT_KEY;
  initialized = true;
  if (!key) return false; // not configured -> no-op
  init({ projectKey: key, host: process.env.COUNTED_AGENT_HOST || "https://app.counted.dev" });
  return true;
}

function langOf(filePath: string): string | undefined {
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    mjs: "javascript", cjs: "javascript", py: "python", go: "go", rs: "rust",
    json: "json", md: "markdown", css: "css", html: "html", sql: "sql",
    sh: "shell", yml: "yaml", yaml: "yaml", toml: "toml",
  };
  return map[ext] || ext || undefined;
}

function relPath(filePath: string, cwd?: string): string {
  if (cwd && filePath.startsWith(cwd)) {
    return filePath.slice(cwd.length).replace(/^\/+/, "") || filePath;
  }
  return filePath.split("/").pop() || filePath;
}

function cmdName(command: string): string {
  const tok = command.trim().split(/\s+/)[0] || "";
  return tok.split("/").pop() || tok;
}

export const CountedPlugin = async (input: PluginInput): Promise<Hooks> => {
  const cwd = input.directory || input.worktree;
  ensureInit();

  return {
    // OpenCode hands the plugin the merged config — fingerprint the setup once.
    config: async (config: Record<string, any>) => {
      registerSetup(config);
    },

    // Session lifecycle comes through the generic event stream.
    event: async ({ event }: { event: { type?: string } }) => {
      if (!ensureInit()) return;
      if (event?.type === "session.created" && !sessionStarted) {
        sessionStarted = true;
        trackSessionStart({ mode: "agent" });
      } else if (event?.type === "session.idle") {
        // De-facto end-of-turn — a good moment to flush buffered events.
        await getAnalytics()?.flush();
      }
    },

    // Fires after each successful tool call. (OpenCode surfaces failures on the
    // event stream, not here, so a delivered after-hook means success.)
    "tool.execute.after": async (toolInput: { tool?: string; args?: any }) => {
      if (!ensureInit()) return;
      const tool = toolInput?.tool || "unknown";
      trackToolUse({ tool, outcome: "success" });

      const args = toolInput?.args || {};
      if ((tool === "edit" || tool === "write") && args.filePath) {
        trackFileEdit({
          filePath: relPath(args.filePath, cwd),
          action: tool === "write" ? "create" : "edit",
          language: langOf(args.filePath),
        });
      } else if (tool === "bash" && args.command) {
        trackCommand({ command: cmdName(args.command) });
      }
    },

    // Flush whatever is buffered when OpenCode tears the plugin down.
    dispose: async () => {
      await getAnalytics()?.flush();
      destroy();
    },
  };
};

export default CountedPlugin;
