// ../sdk/dist/chunk-CF3O333Q.js
var i = null;
var n = 0;
var o = 18e5;
function u() {
  let t = Math.floor(Date.now() / 1e3), e = Math.random().toString(36).substring(2, 10);
  return `${t}.${e}`;
}
function a(t) {
  t.sessionId && (i = t.sessionId, n = Date.now()), t.sessionTimeout !== void 0 && (o = t.sessionTimeout);
}
function l() {
  let t = Date.now();
  return (!i || o > 0 && t - n > o) && (i = u()), n = t, i;
}
var p = "counted/0.0.1";
function c() {
  let t = { osName: null, osVersion: null, locale: null, appVersion: null, deviceModel: null, sdkVersion: p, isDebug: false };
  if (typeof globalThis.navigator < "u") {
    let e = globalThis.navigator.userAgent;
    if (e.includes("Mac OS X")) {
      t.osName = "macOS";
      let s = e.match(/Mac OS X (\d+[._]\d+[._]?\d*)/);
      s && (t.osVersion = s[1].replace(/_/g, "."));
    } else if (e.includes("Windows")) {
      t.osName = "Windows";
      let s = e.match(/Windows NT (\d+\.\d+)/);
      s && (t.osVersion = s[1]);
    } else if (e.includes("Linux")) t.osName = "Linux";
    else if (e.includes("Android")) {
      t.osName = "Android";
      let s = e.match(/Android (\d+[\.\d]*)/);
      s && (t.osVersion = s[1]);
    } else if (e.includes("iPhone") || e.includes("iPad")) {
      t.osName = "iOS";
      let s = e.match(/OS (\d+[_\d]*)/);
      s && (t.osVersion = s[1].replace(/_/g, "."));
    }
    t.locale = globalThis.navigator.language ?? null;
  }
  return typeof process < "u" && process.versions?.node && (t.osName = process.platform, t.osVersion = process.version), t;
}
function h(t, e) {
  if (typeof globalThis.navigator?.sendBeacon == "function") {
    let s = new Blob([JSON.stringify(e)], { type: "application/json" });
    return globalThis.navigator.sendBeacon(t, s);
  }
  return false;
}
async function f(t, e, s) {
  try {
    return (await fetch(t, { method: "POST", headers: { "Content-Type": "application/json", "Project-Key": s }, body: JSON.stringify(e.length === 1 ? e[0] : e), keepalive: true })).ok;
  } catch {
    return false;
  }
}
var m = "https://counted.dev";
var v = 3e4;
var g = 50;
var d = class {
  projectKey;
  host;
  flushInterval;
  maxBatchSize;
  buffer = [];
  timer = null;
  enabled = true;
  constructor(e) {
    this.projectKey = e.projectKey, this.host = e.host ?? m, this.flushInterval = e.flushInterval ?? v, this.maxBatchSize = e.maxBatchSize ?? g, a({ sessionId: e.sessionId, sessionTimeout: e.sessionTimeout }), this.startTimer(), this.registerUnloadHandler();
  }
  track(e, s) {
    if (!this.enabled) return;
    let r = { timestamp: (/* @__PURE__ */ new Date()).toISOString(), sessionId: l(), eventName: e, systemProps: c(), props: s ?? {} };
    this.buffer.push(r), this.buffer.length >= this.maxBatchSize && this.flush();
  }
  async flush() {
    if (this.buffer.length === 0) return;
    let e = this.buffer.splice(0, this.maxBatchSize), s = `${this.host}/api/v0/event`;
    await f(s, e, this.projectKey);
  }
  disable() {
    this.enabled = false, this.buffer = [], this.stopTimer();
  }
  enable() {
    this.enabled = true, this.startTimer();
  }
  destroy() {
    this.stopTimer(), this.flush();
  }
  startTimer() {
    this.timer || (this.timer = setInterval(() => this.flush(), this.flushInterval), typeof this.timer == "object" && "unref" in this.timer && this.timer.unref());
  }
  stopTimer() {
    this.timer && (clearInterval(this.timer), this.timer = null);
  }
  registerUnloadHandler() {
    typeof globalThis.document < "u" && globalThis.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && this.buffer.length > 0) {
        let e = `${this.host}/api/v0/event`;
        h(e, this.buffer), this.buffer = [];
      }
    }), typeof globalThis.process < "u" && globalThis.process.on && globalThis.process.on("beforeExit", () => {
      this.flush();
    });
  }
};

// src/index.ts
var analytics = null;
function init(options) {
  analytics = new d({
    projectKey: options.projectKey,
    host: options.host,
    sessionId: options.sessionId,
    sessionTimeout: 0,
    // Never auto-reset — agent sessions are explicit
    flushInterval: options.flushInterval ?? 1e4
  });
}
function trackToolUse(props) {
  analytics?.track("tool_use", props);
}
function trackFileEdit(props) {
  analytics?.track("file_edit", props);
}
function trackCommand(props) {
  analytics?.track("command_run", props);
}
function trackSessionStart(props) {
  analytics?.track("session_start", props ?? {});
}
function trackSessionEnd(props) {
  analytics?.track("session_end", props ?? {});
}
function getAnalytics() {
  return analytics;
}

// src/hook.ts
var key = process.env.COUNTED_AGENT_KEY;
if (!key) process.exit(0);
var killer = setTimeout(() => process.exit(0), 4e3);
if (typeof killer.unref === "function") killer.unref();
function langOf(filePath) {
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  const map = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    go: "go",
    rs: "rust",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    sql: "sql",
    sh: "shell",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml"
  };
  return map[ext] || ext || void 0;
}
function relPath(filePath, cwd) {
  if (cwd && filePath.startsWith(cwd)) {
    return filePath.slice(cwd.length).replace(/^\/+/, "") || filePath;
  }
  return filePath.split("/").pop() || filePath;
}
function cmdName(command) {
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
          language: langOf(ti.file_path)
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
main().catch(() => {
}).finally(() => {
  clearTimeout(killer);
  process.exit(0);
});
