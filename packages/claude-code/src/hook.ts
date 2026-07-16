// Claude Code hook entry for the Counted plugin. Bundled (with @counted/sdk
// inlined) to bin/counted-hook.mjs so it runs as a zero-dependency plugin
// script — no node_modules at the install site. Claude Code runs it once per
// hook event (SessionStart / PostToolUse / SessionEnd), passing the event JSON
// on stdin; see hooks/hooks.json.
//
// Rules: no-op unless a key is configured; never block or break a session
// (errors swallowed, always exit 0, hard self-timeout); privacy-safe — tool
// name + outcome only, file paths repo-relative, commands reduced to the binary.
//
// Key source: COUNTED_AGENT_KEY, or CLAUDE_PLUGIN_OPTION_API_KEY — Claude Code
// exports a plugin's userConfig values to the hook process as
// CLAUDE_PLUGIN_OPTION_<KEY> (the hooks.json "env" mapping is unsupported).
import {
  init,
  trackSessionStart,
  trackToolUse,
  trackFileEdit,
  trackCommand,
  trackSessionEnd,
  getAnalytics,
} from "./index";
import { computeAndCacheSetup, loadSetup, setupContext } from "./setup";

const key = process.env.COUNTED_AGENT_KEY || process.env.CLAUDE_PLUGIN_OPTION_API_KEY;

const killer = setTimeout(() => process.exit(0), 4000);
if (typeof killer.unref === "function") killer.unref();

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
  return filePath.split("/").pop() || filePath; // basename — never leak home dir
}

function cmdName(command: string): string {
  const tok = command.trim().split(/\s+/)[0] || "";
  return tok.split("/").pop() || tok;
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;

  let input: any;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  if (!key) {
    // Not configured -> do nothing. Surface it once, on SessionStart only, so the
    // silent no-op is diagnosable without spamming every event.
    if (input.hook_event_name === "SessionStart") {
      process.stderr.write(
        "counted: no project key found (set the plugin's api_key, or COUNTED_AGENT_KEY) — analytics disabled\n",
      );
    }
    return;
  }

  const host =
    process.env.COUNTED_AGENT_HOST ||
    process.env.CLAUDE_PLUGIN_OPTION_HOST ||
    "https://app.counted.dev";
  // The Claude session id becomes the Counted session id (sessionTimeout: 0),
  // so every event from one Claude session groups together.
  init({ projectKey: key!, host, sessionId: input.session_id });

  // Register the setup fingerprint as context so it rides on every event,
  // letting users break metrics down by agentic setup. The model is only on
  // SessionStart, so it's cached there and reloaded for later events.
  const cwd: string = input.cwd || process.cwd();
  const setup =
    input.hook_event_name === "SessionStart"
      ? computeAndCacheSetup(cwd, input.session_id, input.model, input.permission_mode)
      : loadSetup(cwd, input.session_id, input.permission_mode);
  getAnalytics()?.register(setupContext(setup));

  switch (input.hook_event_name) {
    case "SessionStart":
      trackSessionStart({ model: input.model, mode: input.source });
      break;
    // PostToolUse fires only on tool success; PostToolUseFailure only on
    // failure. Splitting the outcome across the two events is what makes the
    // dashboard's tool-outcome breakdown meaningful (a single PostToolUse read
    // reported success forever).
    case "PostToolUse":
    case "PostToolUseFailure": {
      const tool: string = input.tool_name || "unknown";
      const failed = input.hook_event_name === "PostToolUseFailure";
      trackToolUse({ tool, outcome: failed ? "error" : "success" });

      const ti = input.tool_input || {};
      if ((tool === "Write" || tool === "Edit" || tool === "MultiEdit") && ti.file_path) {
        trackFileEdit({
          filePath: relPath(ti.file_path, input.cwd),
          action: tool === "Write" ? "create" : "edit",
          language: langOf(ti.file_path),
        });
      } else if (tool === "Bash" && ti.command) {
        // On failure mark a nonzero exit; success leaves it unset (Claude Code
        // does not surface a real exit code to the hook).
        trackCommand({ command: cmdName(ti.command), exitCode: failed ? 1 : undefined });
      }
      break;
    }
    case "SessionEnd":
      trackSessionEnd({});
      break;
  }

  await getAnalytics()?.flush();
}

main()
  .catch(() => {})
  .finally(() => {
    clearTimeout(killer);
    process.exit(0);
  });
