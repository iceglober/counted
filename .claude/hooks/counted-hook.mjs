#!/usr/bin/env node
// Counted agent-dogfooding bridge for Claude Code hooks.
//
// Reads a hook event from stdin and forwards a privacy-safe analytics event to
// Counted via the in-repo @counted/claude-code package. Wired from
// .claude/settings.json for SessionStart, PostToolUse, and SessionEnd.
//
// Design rules:
//   - No-op unless COUNTED_AGENT_KEY is set, so committing the hooks is safe.
//   - Never block or break a session: all errors swallowed, always exit 0,
//     hard self-timeout so a slow network can't hang anything.
//   - Privacy: tool name + outcome only; file paths repo-relative (no content),
//     commands reduced to the binary name (no args). Mirrors the package's stance.

const key = process.env.COUNTED_AGENT_KEY;
if (!key) process.exit(0); // not configured -> do nothing

// Safety net: never let the hook outlive a few seconds.
const killer = setTimeout(() => process.exit(0), 4000);
if (typeof killer.unref === "function") killer.unref();

function langOf(filePath) {
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  const map = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    mjs: "javascript", cjs: "javascript", py: "python", go: "go", rs: "rust",
    json: "json", md: "markdown", css: "css", html: "html", sql: "sql",
    sh: "shell", yml: "yaml", yaml: "yaml", toml: "toml",
  };
  return map[ext] || ext || undefined;
}

function relPath(filePath, cwd) {
  if (cwd && filePath.startsWith(cwd)) {
    return filePath.slice(cwd.length).replace(/^\/+/, "") || filePath;
  }
  return filePath.split("/").pop() || filePath; // basename — never leak home dir
}

function cmdName(command) {
  // First bare token: the binary name, no arguments.
  const tok = command.trim().split(/\s+/)[0] || "";
  return tok.split("/").pop() || tok;
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const host = process.env.COUNTED_AGENT_HOST || "https://app.counted.dev";
  const mod = await import(
    new URL("../../packages/claude-code/dist/index.js", import.meta.url)
  );
  const { init, trackSessionStart, trackToolUse, trackFileEdit, trackCommand, trackSessionEnd, getAnalytics } = mod;

  // The Claude session id becomes the Counted session id (sessionTimeout: 0),
  // so every event from one Claude session groups together.
  init({ projectKey: key, host, sessionId: input.session_id });

  switch (input.hook_event_name) {
    case "SessionStart":
      trackSessionStart({ model: input.model, mode: input.source });
      break;
    case "PostToolUse": {
      const tool = input.tool_name || "unknown";
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
