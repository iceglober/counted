// ../sdk/dist/chunk-YBVLU2GX.js
function a() {
  let t = { path: window.location.pathname }, { search: r2 } = window.location;
  return r2 && (t.search = r2), document.referrer && (t.referrer = document.referrer), document.title && (t.title = document.title), t;
}
function s(t) {
  if (typeof window > "u") return () => {
  };
  let r2 = window.location.href;
  function o() {
    let e = window.location.href;
    e !== r2 && (r2 = e, t.track("page_view", a()));
  }
  t.track("page_view", a());
  let i2 = history.pushState.bind(history), n = history.replaceState.bind(history);
  return history.pushState = function(...e) {
    i2(...e), o();
  }, history.replaceState = function(...e) {
    n(...e), o();
  }, window.addEventListener("popstate", o), () => {
    history.pushState = i2, history.replaceState = n, window.removeEventListener("popstate", o);
  };
}

// ../sdk/dist/chunk-MHINEWW6.js
function y() {
  let n = Math.floor(Date.now() / 1e3), e = Math.random().toString(36).substring(2, 10);
  return `${n}.${e}`;
}
var r = class {
  sessionId = null;
  lastActivity = 0;
  timeoutMs = 18e5;
  constructor(e = {}) {
    e.sessionId && (this.sessionId = e.sessionId, this.lastActivity = Date.now()), e.sessionTimeout !== void 0 && (this.timeoutMs = e.sessionTimeout);
  }
  getSessionId() {
    let e = Date.now();
    return (!this.sessionId || this.timeoutMs > 0 && e - this.lastActivity > this.timeoutMs) && (this.sessionId = y()), this.lastActivity = e, this.sessionId;
  }
};
var S = "0.1.1";
var T = `counted/${S}`;
var E = { darwin: "macOS", win32: "Windows", linux: "Linux" };
function d(n) {
  let e = { osName: null, osVersion: null, locale: null, appVersion: n ?? null, deviceModel: null, sdkVersion: T, isDebug: false };
  if (typeof globalThis.navigator < "u" && globalThis.navigator.userAgent) {
    let s2 = globalThis.navigator.userAgent;
    if (s2.includes("Mac OS X")) {
      e.osName = "macOS";
      let t = s2.match(/Mac OS X (\d+[._]\d+[._]?\d*)/);
      t && (e.osVersion = t[1].replace(/_/g, "."));
    } else if (s2.includes("Windows")) {
      e.osName = "Windows";
      let t = s2.match(/Windows NT (\d+\.\d+)/);
      t && (e.osVersion = t[1]);
    } else if (s2.includes("Linux")) e.osName = "Linux";
    else if (s2.includes("Android")) {
      e.osName = "Android";
      let t = s2.match(/Android (\d+[\.\d]*)/);
      t && (e.osVersion = t[1]);
    } else if (s2.includes("iPhone") || s2.includes("iPad")) {
      e.osName = "iOS";
      let t = s2.match(/OS (\d+[_\d]*)/);
      t && (e.osVersion = t[1].replace(/_/g, "."));
    }
    e.locale = globalThis.navigator.language ?? null;
  }
  if (typeof process < "u" && process.versions?.node) {
    e.osName = E[process.platform] ?? process.platform;
    let s2 = process.getBuiltinModule;
    if (typeof s2 == "function") try {
      let t = s2("os");
      e.osVersion = t?.release?.() ?? null;
    } catch {
      e.osVersion = null;
    }
    else e.osVersion = null;
  }
  return e;
}
var f = /* @__PURE__ */ new Set();
function p(n, e) {
  if (typeof globalThis.navigator?.sendBeacon == "function") {
    let s2 = new Blob([JSON.stringify(e)], { type: "application/json" });
    return globalThis.navigator.sendBeacon(n, s2);
  }
  return false;
}
async function m(n, e, s2, t = {}) {
  try {
    let i2 = await fetch(n, { method: "POST", headers: { "Content-Type": "application/json", "Project-Key": s2 }, body: JSON.stringify(e.length === 1 ? e[0] : e), keepalive: true });
    if (!i2.ok) {
      let o = "";
      try {
        o = (await i2.text()).slice(0, 500);
      } catch {
      }
      (i2.status === 401 || i2.status === 403 || !f.has(i2.status)) && (f.add(i2.status), console.warn(`[counted] event ingestion failed (HTTP ${i2.status})${o ? `: ${o}` : ""}`));
      let u2;
      if (i2.status === 429) {
        let h = i2.headers.get("Retry-After"), a2 = h ? Number(h) : NaN;
        Number.isFinite(a2) && a2 >= 0 && (u2 = a2);
      }
      return { ok: false, status: i2.status, retryAfter: u2 };
    }
    return t.debug && console.log(`[counted] flushed ${e.length} event(s)`), { ok: true, status: i2.status };
  } catch (i2) {
    return t.debug && console.warn("[counted] network error during flush", i2), { ok: false, status: 0 };
  }
}
var w = "https://app.counted.dev";
var _ = 3e4;
var g = 50;
var v = 1e3;
function l(n) {
  let e = {};
  for (let s2 of Object.keys(n)) n[s2] !== void 0 && (e[s2] = n[s2]);
  return e;
}
var b = class {
  projectKey;
  host;
  flushInterval;
  maxBatchSize;
  appVersion;
  debug;
  buffer = [];
  timer = null;
  enabled = true;
  context;
  session;
  pausedUntil = 0;
  autoTrackCleanup = null;
  onVisibilityChange = null;
  onBeforeExit = null;
  constructor(e) {
    this.projectKey = e.projectKey, this.host = e.host ?? w, this.flushInterval = e.flushInterval ?? _, this.maxBatchSize = Math.min(e.maxBatchSize ?? g, g), this.appVersion = e.appVersion, this.debug = e.debug ?? false, this.context = l({ ...e.context ?? {} }), this.session = new r({ sessionId: e.sessionId, sessionTimeout: e.sessionTimeout }), this.validateKey(), this.startTimer(), this.registerUnloadHandler(), e.autoTrack && typeof window < "u" && (this.autoTrackCleanup = s(this));
  }
  register(e) {
    this.context = l({ ...this.context, ...e });
  }
  track(e, s2) {
    if (!this.enabled) return;
    let t = { timestamp: (/* @__PURE__ */ new Date()).toISOString(), sessionId: this.session.getSessionId(), eventName: e, systemProps: d(this.appVersion), props: l({ ...this.context, ...s2 ?? {} }) };
    this.buffer.push(t), this.debug && console.log(`[counted] track "${e}"`, t.props), this.buffer.length >= this.maxBatchSize && this.flush();
  }
  async flush() {
    if (this.buffer.length !== 0 && !(this.pausedUntil > Date.now())) for (; this.buffer.length > 0; ) {
      let e = this.buffer.splice(0, this.maxBatchSize), s2 = `${this.host}/api/v0/event`, t = await m(s2, e, this.projectKey, { debug: this.debug });
      if (!t.ok) {
        this.buffer = e.concat(this.buffer), this.buffer.length > v && this.buffer.splice(0, this.buffer.length - v), t.status === 429 && t.retryAfter !== void 0 && (this.pausedUntil = Date.now() + t.retryAfter * 1e3);
        return;
      }
    }
  }
  disable() {
    this.enabled = false, this.buffer = [], this.stopTimer();
  }
  enable() {
    this.enabled = true, this.startTimer();
  }
  async destroy() {
    this.stopTimer(), this.removeUnloadHandlers(), this.autoTrackCleanup && (this.autoTrackCleanup(), this.autoTrackCleanup = null), await this.flush();
  }
  validateKey() {
    let e = this.projectKey;
    (!e || !e.startsWith("ck_") && !e.startsWith("A-US-")) && console.warn('[counted] projectKey looks invalid \u2014 expected a client key starting with "ck_" (or legacy "A-US-"). Events will likely be rejected.');
  }
  startTimer() {
    this.timer || (this.timer = setInterval(() => {
      this.flush();
    }, this.flushInterval), typeof this.timer == "object" && "unref" in this.timer && this.timer.unref());
  }
  stopTimer() {
    this.timer && (clearInterval(this.timer), this.timer = null);
  }
  beaconFlush() {
    if (this.buffer.length === 0) return;
    let e = `${this.host}/api/v0/event?key=${encodeURIComponent(this.projectKey)}`, s2 = this.buffer;
    this.buffer = [];
    for (let t = 0; t < s2.length; t += this.maxBatchSize) {
      let i2 = s2.slice(t, t + this.maxBatchSize);
      p(e, i2) || fetch(e, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(i2), keepalive: true }).catch(() => {
      });
    }
  }
  registerUnloadHandler() {
    typeof globalThis.document < "u" && (this.onVisibilityChange = () => {
      globalThis.document.visibilityState === "hidden" && this.beaconFlush();
    }, globalThis.addEventListener("visibilitychange", this.onVisibilityChange)), typeof globalThis.process < "u" && globalThis.process.on && (this.onBeforeExit = () => {
      this.flush();
    }, globalThis.process.on("beforeExit", this.onBeforeExit));
  }
  removeUnloadHandlers() {
    this.onVisibilityChange && typeof globalThis.removeEventListener == "function" && (globalThis.removeEventListener("visibilitychange", this.onVisibilityChange), this.onVisibilityChange = null), this.onBeforeExit && typeof globalThis.process < "u" && globalThis.process.off && (globalThis.process.off("beforeExit", this.onBeforeExit), this.onBeforeExit = null);
  }
};

// ../sdk/dist/index.js
function i(n) {
  if (n != null) {
    if (Array.isArray(n)) return n.map(i);
    if (typeof n == "object") {
      let t = n, r2 = {};
      for (let e of Object.keys(t).sort()) {
        let o = i(t[e]);
        o !== void 0 && (r2[e] = o);
      }
      return r2;
    }
    return n;
  }
}
function u(n) {
  let t = 2166136261, r2 = 3266489909;
  for (let e = 0; e < n.length; e++) {
    let o = n.charCodeAt(e);
    t = Math.imul(t ^ o, 16777619) >>> 0, r2 = Math.imul(r2 ^ o, 2246822507) >>> 0;
  }
  return (t >>> 0).toString(16).padStart(8, "0") + (r2 >>> 0).toString(16).padStart(8, "0");
}
function p2(n) {
  return { setupHash: u(JSON.stringify(i(n))), setupHashVersion: 1 };
}

// src/index.ts
var analytics = null;
function init(options) {
  analytics = new b({
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

// src/setup.ts
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
function readSafe(p3) {
  try {
    return readFileSync(p3, "utf8");
  } catch {
    return void 0;
  }
}
function gatherInputs(cwd, model, permissionMode) {
  const claudeMd = readSafe(join(cwd, "CLAUDE.md"));
  const agents = {};
  try {
    for (const f2 of readdirSync(join(cwd, ".claude", "agents")).sort()) {
      const c = readSafe(join(cwd, ".claude", "agents", f2));
      if (c) agents[f2] = c;
    }
  } catch {
  }
  let permissions;
  try {
    const settings = readSafe(join(cwd, ".claude", "settings.json"));
    if (settings) permissions = JSON.parse(settings).permissions;
  } catch {
  }
  return {
    model,
    permissionMode,
    prompts: { claudeMd, agents },
    tools: { permissions }
  };
}
var cachePath = (sessionId) => join(tmpdir(), `counted-setup-${sessionId.replace(/[^\w.-]/g, "_")}.json`);
function compute(cwd, sessionId, model, permissionMode) {
  const { setupHash, setupHashVersion } = p2(gatherInputs(cwd, model, permissionMode));
  const setup = { model, setupHash, setupHashVersion };
  const label = process.env.COUNTED_SETUP_LABEL;
  if (label) setup.setupLabel = label;
  try {
    writeFileSync(cachePath(sessionId), JSON.stringify(setup));
  } catch {
  }
  return setup;
}
function computeAndCacheSetup(cwd, sessionId, model, permissionMode) {
  return compute(cwd, sessionId, model, permissionMode);
}
function loadSetup(cwd, sessionId, permissionMode) {
  try {
    return JSON.parse(readFileSync(cachePath(sessionId), "utf8"));
  } catch {
    return compute(cwd, sessionId, void 0, permissionMode);
  }
}
function setupContext(setup) {
  const ctx = {
    setupHash: setup.setupHash,
    setupHashVersion: setup.setupHashVersion
  };
  if (setup.model) ctx.model = setup.model;
  if (setup.setupLabel) ctx.setupLabel = setup.setupLabel;
  return ctx;
}

// src/hook.ts
var key = process.env.COUNTED_AGENT_KEY || process.env.CLAUDE_PLUGIN_OPTION_API_KEY;
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
  if (!key) {
    if (input.hook_event_name === "SessionStart") {
      process.stderr.write(
        "counted: no project key found (set the plugin's api_key, or COUNTED_AGENT_KEY) \u2014 analytics disabled\n"
      );
    }
    return;
  }
  const host = process.env.COUNTED_AGENT_HOST || process.env.CLAUDE_PLUGIN_OPTION_HOST || "https://app.counted.dev";
  init({ projectKey: key, host, sessionId: input.session_id });
  const cwd = input.cwd || process.cwd();
  const setup = input.hook_event_name === "SessionStart" ? computeAndCacheSetup(cwd, input.session_id, input.model, input.permission_mode) : loadSetup(cwd, input.session_id, input.permission_mode);
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
      const tool = input.tool_name || "unknown";
      const failed = input.hook_event_name === "PostToolUseFailure";
      trackToolUse({ tool, outcome: failed ? "error" : "success" });
      const ti = input.tool_input || {};
      if ((tool === "Write" || tool === "Edit" || tool === "MultiEdit") && ti.file_path) {
        trackFileEdit({
          filePath: relPath(ti.file_path, input.cwd),
          action: tool === "Write" ? "create" : "edit",
          language: langOf(ti.file_path)
        });
      } else if (tool === "Bash" && ti.command) {
        trackCommand({ command: cmdName(ti.command), exitCode: failed ? 1 : void 0 });
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
