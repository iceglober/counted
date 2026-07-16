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
  trackSessionEnd,
  trackToolUse,
  trackFileEdit,
  trackCommand,
  getAnalytics,
  destroy,
} from "./api";
import { setupFingerprint } from "@counted/sdk";

// Minimal structural types — the authoritative ones live in @opencode-ai/plugin.
type Hooks = Record<string, (...args: any[]) => any>;
type PluginInput = { directory?: string; worktree?: string; [k: string]: unknown };

let initialized = false;
// Counted session id currently configured on the SDK. OpenCode can drive many
// sessions through one server process, so we re-key the SDK to each OpenCode
// session id rather than collapsing everything into one process-lifetime session.
let currentSessionId: string | undefined;
// The setup fingerprint context is registered once, then re-applied whenever we
// re-init the SDK for a new session id (a fresh Analytics loses registered ctx).
let setupCtx: Record<string, string | number> | undefined;

// Hash a deliberate, versioned slice of the OpenCode config: model, agent/prompt
// definitions, tools/permissions, and sampling params. Register it as context so
// every event carries the setup fingerprint (only the digest leaves the machine).
function registerSetup(config: Record<string, any> | undefined) {
  if (setupCtx || !config) return;
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
  setupCtx = ctx;
  getAnalytics()?.register(ctx);
}

function ensureInit(): boolean {
  if (initialized) return getAnalytics() !== null;
  const key = process.env.COUNTED_AGENT_KEY;
  initialized = true;
  if (!key) return false; // not configured -> no-op
  init({ projectKey: key, host: process.env.COUNTED_AGENT_HOST || "https://app.counted.dev" });
  return true;
}

// Re-key the SDK to an OpenCode session id so events group per session. Flushes
// the outgoing session first and re-applies the setup context to the fresh
// instance. Returns true when the session id actually changed (a new session).
function ensureSession(sessionId: string | undefined): boolean {
  if (!sessionId || sessionId === currentSessionId) return false;
  const key = process.env.COUNTED_AGENT_KEY;
  if (!key) return false;
  getAnalytics()?.flush();
  init({ projectKey: key, host: process.env.COUNTED_AGENT_HOST || "https://app.counted.dev", sessionId });
  initialized = true;
  currentSessionId = sessionId;
  if (setupCtx) getAnalytics()?.register(setupCtx);
  return true;
}

// OpenCode session events carry the session object under a few shapes depending
// on version; pull the id defensively without leaking anything else.
function sessionIdOf(event: any): string | undefined {
  return (
    event?.properties?.info?.id ??
    event?.properties?.sessionID ??
    event?.properties?.sessionId ??
    event?.properties?.id
  );
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

  // OpenCode tool hooks are (input, output): input carries { tool, sessionID,
  // callID } and the tool arguments live on output.args. Capture args in the
  // before-hook keyed by callID so the after-hook can attribute file/command
  // detail (output.args may not survive to `after` in every version).
  const pendingArgs = new Map<string, any>();

  return {
    // OpenCode hands the plugin the merged config — fingerprint the setup once.
    config: async (config: Record<string, any>) => {
      registerSetup(config);
    },

    // Session lifecycle comes through the generic event stream. Each OpenCode
    // session becomes its own Counted session.
    event: async ({ event }: { event: { type?: string } }) => {
      if (!ensureInit()) return;
      const type = event?.type;
      if (type === "session.created") {
        ensureSession(sessionIdOf(event));
        trackSessionStart({ mode: "agent" });
      } else if (type === "session.deleted") {
        ensureSession(sessionIdOf(event));
        trackSessionEnd({});
        await getAnalytics()?.flush();
      } else if (type === "session.idle") {
        // De-facto end-of-turn — a good moment to flush buffered events.
        await getAnalytics()?.flush();
      }
    },

    // Capture tool arguments before execution, keyed by callID.
    "tool.execute.before": async (
      hookInput: { tool?: string; sessionID?: string; callID?: string },
      output: { args?: any },
    ) => {
      if (!ensureInit()) return;
      if (hookInput?.callID && output?.args !== undefined) {
        pendingArgs.set(hookInput.callID, output.args);
      }
    },

    // Fires after each successful tool call. (OpenCode surfaces failures on the
    // event stream, not here, so a delivered after-hook means success.)
    "tool.execute.after": async (
      hookInput: { tool?: string; sessionID?: string; callID?: string },
      output: { args?: any },
    ) => {
      if (!ensureInit()) return;
      // Key events to the tool's session even if session.created was missed.
      ensureSession(hookInput?.sessionID);

      const tool = hookInput?.tool || "unknown";
      trackToolUse({ tool, outcome: "success" });

      const callID = hookInput?.callID;
      const args = output?.args ?? (callID ? pendingArgs.get(callID) : undefined) ?? {};
      if (callID) pendingArgs.delete(callID);

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
