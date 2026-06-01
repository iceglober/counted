// Claude Code hook entry for the Counted plugin. Bundled (with @counted/sdk
// inlined) to bin/counted-hook.mjs so it runs as a zero-dependency plugin
// script — no node_modules at the install site. Claude Code runs it once per
// hook event (SessionStart / PostToolUse / SessionEnd), passing the event JSON
// on stdin; see hooks/hooks.json.
//
// Rules: no-op unless COUNTED_AGENT_KEY is set; never block or break a session
// (errors swallowed, always exit 0, hard self-timeout); privacy-safe — tool
// name + outcome only, file paths repo-relative, commands reduced to the binary.
import {
  init,
  trackSessionStart,
  trackToolUse,
  trackFileEdit,
  trackCommand,
  trackSessionEnd,
  getAnalytics,
} from "./index";

const key = process.env.COUNTED_AGENT_KEY;
if (!key) process.exit(0); // not configured -> do nothing

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

  const host = process.env.COUNTED_AGENT_HOST || "https://app.counted.dev";
  // The Claude session id becomes the Counted session id (sessionTimeout: 0),
  // so every event from one Claude session groups together.
  init({ projectKey: key!, host, sessionId: input.session_id });

  switch (input.hook_event_name) {
    case "SessionStart":
      trackSessionStart({ model: input.model, mode: input.source });
      break;
    case "PostToolUse": {
      const tool: string = input.tool_name || "unknown";
      const ok = input.tool_response?.did_succeed;
      trackToolUse({ tool, outcome: ok === false ? "error" : "success" });

      const ti = input.tool_input || {};
      if ((tool === "Write" || tool === "Edit" || tool === "MultiEdit") && ti.file_path) {
        trackFileEdit({
          filePath: relPath(ti.file_path, input.cwd),
          action: tool === "Write" ? "create" : "edit",
          language: langOf(ti.file_path),
        });
      } else if (tool === "Bash" && ti.command) {
        trackCommand({ command: cmdName(ti.command), exitCode: input.tool_response?.exit_code });
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
