#!/usr/bin/env node

// ../sdk-js/src/gen/contract.ts
var BACKOFF = {
  "baseMs": 500,
  "maxMs": 6e4,
  "factor": 2,
  "jitter": "full"
};
var FATAL_STATUSES = [401, 403];

// ../sdk-js/src/queue.ts
var EventQueue = class {
  constructor(capacity) {
    this.capacity = capacity;
  }
  capacity;
  events = [];
  dropped = 0;
  get size() {
    return this.events.length;
  }
  /** How many events have been dropped for capacity. Reported, never silent. */
  get droppedCount() {
    return this.dropped;
  }
  push(event) {
    this.events.push(event);
    this.trim();
  }
  /** Take up to `limit` events from the front. */
  take(limit) {
    return this.events.splice(0, limit);
  }
  /**
   * Return an unsent batch to the head.
   *
   * At the head rather than the tail so a retry does not reorder events behind
   * ones that arrived while it was in flight. Still bounded: a server that has
   * been down for an hour must not turn this into a memory leak.
   */
  requeue(events) {
    this.events.unshift(...events);
    this.trim();
  }
  trim() {
    const excess = this.events.length - this.capacity;
    if (excess <= 0) return;
    this.events.splice(0, excess);
    this.dropped += excess;
  }
};

// ../sdk-js/src/platform.ts
var NODE_PLATFORMS = {
  darwin: "macos",
  win32: "windows",
  linux: "linux",
  freebsd: "freebsd",
  openbsd: "freebsd",
  android: "android"
};
var USER_AGENT_RULES = [
  { match: /iPad/i, platform: "ipados" },
  { match: /iPhone|iPod/i, platform: "ios" },
  { match: /Android/i, platform: "android" },
  { match: /CrOS/i, platform: "chromeos" },
  { match: /Macintosh|Mac OS X/i, platform: "macos" },
  { match: /Windows/i, platform: "windows" },
  { match: /FreeBSD|OpenBSD|NetBSD/i, platform: "freebsd" },
  { match: /Linux|X11/i, platform: "linux" }
];
var userAgent = () => {
  const navigator = globalThis.navigator;
  return typeof navigator?.userAgent === "string" ? navigator.userAgent : null;
};
var nodePlatform = () => {
  const process2 = globalThis.process;
  return typeof process2?.platform === "string" ? process2.platform : null;
};
var detectPlatform = () => {
  const ua = userAgent();
  if (ua !== null) {
    for (const rule of USER_AGENT_RULES) if (rule.match.test(ua)) return rule.platform;
  }
  const node = nodePlatform();
  return node !== null ? NODE_PLATFORMS[node] ?? "other" : "other";
};
var osVersion = () => {
  const ua = userAgent();
  if (ua === null) return null;
  const mac = /Mac OS X (\d+[._]\d+([._]\d+)?)/.exec(ua);
  if (mac?.[1] !== void 0) return mac[1].replace(/_/g, ".");
  const windows = /Windows NT (\d+\.\d+)/.exec(ua);
  if (windows?.[1] !== void 0) return windows[1];
  const android = /Android (\d+(\.\d+)*)/.exec(ua);
  if (android?.[1] !== void 0) return android[1];
  const ios = /OS (\d+[._]\d+([._]\d+)?) like Mac OS X/.exec(ua);
  if (ios?.[1] !== void 0) return ios[1].replace(/_/g, ".");
  return null;
};
var locale = () => {
  const navigator = globalThis.navigator;
  if (typeof navigator?.language === "string") return navigator.language;
  const env = globalThis.process?.env;
  const raw = env?.["LC_ALL"] ?? env?.["LANG"];
  if (raw === void 0 || raw.length === 0) return null;
  const tag = raw.split(".")[0];
  return tag === void 0 || tag.length === 0 ? null : tag.replace("_", "-");
};
var detectSystem = (options) => ({
  os_name: detectPlatform(),
  os_version: osVersion(),
  locale: locale(),
  app_version: options.appVersion ?? null,
  device_model: null,
  sdk_version: options.sdkVersion
});

// ../sdk-js/src/transport.ts
var parseRetryAfter = (header) => {
  if (header === null) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1e3;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
};
var RETRYABLE_STATUSES = [408, 425, 429, 500, 502, 503, 504];
var sendBatch = async (events, options) => {
  const http = options.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15e3);
  try {
    const response = await http(options.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.key}` },
      body: JSON.stringify({ events }),
      // So a flush started as the page unloads is not cancelled with it.
      keepalive: true,
      signal: controller.signal
    });
    if (response.ok) {
      const receipt = await response.json().catch(() => null);
      return {
        kind: "accepted",
        receipt: receipt ?? { accepted: events.length, deduplicated: 0, rejected: 0 }
      };
    }
    const problem = await response.json().catch(() => null);
    const detail = problem?.detail ?? `HTTP ${response.status}`;
    const retryable = problem?.retryable ?? RETRYABLE_STATUSES.includes(response.status);
    if (!retryable) return { kind: "refused", status: response.status, detail };
    return {
      kind: "retry",
      status: response.status,
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
      detail
    };
  } catch (error) {
    return {
      kind: "retry",
      status: 0,
      retryAfterMs: null,
      detail: error instanceof Error ? error.message : "network error"
    };
  } finally {
    clearTimeout(timeout);
  }
};
var sendBeacon = (events, options) => {
  const navigator = globalThis.navigator;
  if (typeof navigator?.sendBeacon !== "function") return false;
  const url = `${options.endpoint}${options.endpoint.includes("?") ? "&" : "?"}key=${encodeURIComponent(options.key)}`;
  const blob = new Blob([JSON.stringify({ events })], { type: "application/json" });
  try {
    return navigator.sendBeacon(url, blob);
  } catch {
    return false;
  }
};

// ../sdk-js/src/visit.ts
var DEFAULT_IDLE_MS = 30 * 60 * 1e3;
var Visit = class {
  id = null;
  lastActivity = 0;
  idleMs;
  now;
  random;
  constructor(options = {}) {
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    if (options.visitId !== void 0) {
      this.id = options.visitId;
      this.lastActivity = this.now();
    }
  }
  /** The current visit, rolling over once it has been idle too long. */
  current() {
    const now = this.now();
    if (this.id === null || this.idleMs > 0 && now - this.lastActivity > this.idleMs) {
      this.id = this.mint(now);
    }
    this.lastActivity = now;
    return this.id;
  }
  /**
   * Start a new visit deliberately.
   *
   * Called by `reset()` on sign-out: continuing to group a new person's events
   * under the previous visitor's id is the kind of thing that looks like a
   * privacy incident even when no identity was involved.
   */
  restart() {
    this.id = this.mint(this.now());
    this.lastActivity = this.now();
    return this.id;
  }
  mint(now) {
    return `${Math.floor(now / 1e3)}.${this.random().toString(36).slice(2, 10)}`;
  }
};

// ../sdk-js/src/client.ts
var SDK_VERSION = "counted-js/2.0.0";
var DEFAULTS = {
  endpoint: "https://api.counted.dev/v1/events",
  flushIntervalMs: 5e3,
  maxBatchSize: 50,
  maxQueueSize: 1e3
};
var Counted = class {
  queue;
  visit;
  system;
  options;
  now;
  random;
  person = null;
  timer = null;
  inFlight = null;
  pausedUntil = 0;
  attempt = 0;
  closed = false;
  disabled = false;
  warned = /* @__PURE__ */ new Set();
  constructor(options) {
    this.options = {
      ...options,
      endpoint: options.endpoint ?? DEFAULTS.endpoint,
      flushIntervalMs: options.flushIntervalMs ?? DEFAULTS.flushIntervalMs,
      maxBatchSize: Math.min(options.maxBatchSize ?? DEFAULTS.maxBatchSize, 250)
    };
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.queue = new EventQueue(options.maxQueueSize ?? DEFAULTS.maxQueueSize);
    this.visit = new Visit({ ...options.visitId === void 0 ? {} : { visitId: options.visitId }, now: this.now });
    this.system = detectSystem({
      ...options.appVersion === void 0 ? {} : { appVersion: options.appVersion },
      sdkVersion: SDK_VERSION
    });
    this.startTimer();
    this.watchLifecycle();
  }
  /**
   * Attribute subsequent events to a person.
   *
   * The only way a durable identity enters Counted, and it is always the
   * customer's own id — we never derive, infer or invent one. Pass something
   * opaque: the server refuses anything that looks like an email address,
   * because putting one in a product whose promise is that it stores no
   * personal data is a mistake worth failing loudly on.
   */
  identify(userId) {
    const trimmed = userId.trim();
    this.person = trimmed.length === 0 ? null : trimmed;
  }
  /**
   * Forget the person and start a new visit.
   *
   * For sign-out. Keeping the visit would group the next person's events with
   * the last one's, which looks like a privacy incident even though no
   * identity was involved.
   */
  reset() {
    this.person = null;
    this.visit.restart();
  }
  track(name, properties) {
    if (this.closed || this.disabled) return;
    const before = this.queue.droppedCount;
    this.queue.push({
      name,
      visitId: this.visit.current(),
      ...this.person === null ? {} : { userId: this.person },
      // Stamped now, and held through every retry. The server's dedup key is
      // (key, instant), so regenerating either would double-count a retry.
      occurredAt: new Date(this.now()).toISOString(),
      idempotencyKey: this.mintKey(),
      ...properties === void 0 ? {} : { properties },
      systemProperties: this.system
    });
    const dropped = this.queue.droppedCount - before;
    if (dropped > 0) this.report({ kind: "dropped", events: dropped, reason: "queue_full" });
    if (this.queue.size >= this.options.maxBatchSize) void this.flush();
  }
  /** Send what is queued. Safe to call concurrently; overlapping calls join. */
  async flush() {
    if (this.inFlight !== null) return this.inFlight;
    this.inFlight = this.drain().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
  /**
   * Stop, after one last flush.
   *
   * Awaited in a short-lived process — a script, a serverless handler — where
   * the alternative is exiting with events still queued.
   */
  async shutdown() {
    this.closed = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.unwatchLifecycle();
    await this.flush();
  }
  async drain() {
    if (this.disabled || this.queue.size === 0) return;
    if (this.now() < this.pausedUntil) return;
    const batch = this.queue.take(this.options.maxBatchSize);
    if (batch.length === 0) return;
    const outcome = await sendBatch(batch, {
      endpoint: this.options.endpoint,
      key: this.options.key,
      ...this.options.fetch === void 0 ? {} : { fetch: this.options.fetch }
    });
    this.handle(outcome, batch);
  }
  handle(outcome, batch) {
    if (outcome.kind === "accepted") {
      this.attempt = 0;
      this.reportReceipt(outcome.receipt);
      return;
    }
    if (outcome.kind === "refused") {
      if (FATAL_STATUSES.includes(outcome.status)) {
        const discarded = this.queue.size;
        this.queue.take(this.queue.size);
        this.disabled = true;
        this.warnOnce(outcome.status, outcome.detail);
        this.report({ kind: "disabled", status: outcome.status, detail: outcome.detail, discarded });
        return;
      }
      this.warnOnce(outcome.status, outcome.detail);
      this.report({ kind: "refused", status: outcome.status, detail: outcome.detail });
      return;
    }
    if (outcome.retryAfterMs !== null) {
      this.pausedUntil = this.now() + outcome.retryAfterMs;
    } else {
      this.attempt += 1;
      const ceiling = Math.min(BACKOFF.maxMs, BACKOFF.baseMs * BACKOFF.factor ** (this.attempt - 1));
      this.pausedUntil = this.now() + this.random() * ceiling;
    }
    this.queue.requeue(batch);
  }
  reportReceipt(receipt) {
    if (receipt.rejected > 0) {
      const reasons = (receipt.outcomes ?? []).filter((o) => !o.accepted && o.reason !== void 0).map((o) => o.reason);
      this.report({ kind: "rejected", events: receipt.rejected, reasons });
    }
    if (receipt.quota !== void 0 && receipt.quota.state !== "ok") {
      this.report({ kind: "quota", ...receipt.quota });
    }
  }
  report(diagnostic) {
    if (this.options.onDiagnostic !== void 0) {
      this.options.onDiagnostic(diagnostic);
      return;
    }
    if (this.options.debug === true) console.warn("[counted]", diagnostic);
  }
  /** Warn once per status, except for the two that always mean "fix this". */
  warnOnce(status, detail) {
    const always = status === 401 || status === 403;
    if (!always && this.warned.has(status)) return;
    this.warned.add(status);
    console.warn(`[counted] ingestion refused (HTTP ${status}): ${detail}`);
  }
  mintKey() {
    const random = globalThis.crypto;
    if (typeof random?.randomUUID === "function") return random.randomUUID();
    return `${this.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
  startTimer() {
    if (this.options.flushIntervalMs <= 0) return;
    this.timer = setInterval(() => void this.flush(), this.options.flushIntervalMs);
    const timer = this.timer;
    if (typeof timer.unref === "function") timer.unref();
  }
  onHidden = () => {
    const visibility = globalThis.document?.visibilityState;
    if (visibility !== "hidden") return;
    const batch = this.queue.take(this.options.maxBatchSize);
    if (batch.length === 0) return;
    const sent = sendBeacon(batch, { endpoint: this.options.endpoint, key: this.options.key });
    if (!sent) this.queue.requeue(batch);
  };
  onExit = () => {
    void this.flush();
  };
  watchLifecycle() {
    const target = globalThis;
    if (typeof target.addEventListener === "function") {
      target.addEventListener("visibilitychange", this.onHidden);
    }
    if (typeof target.process?.on === "function") {
      target.process.on("beforeExit", this.onExit);
    }
  }
  unwatchLifecycle() {
    const target = globalThis;
    if (typeof target.removeEventListener === "function") {
      target.removeEventListener("visibilitychange", this.onHidden);
    }
  }
};

// ../agent-core/src/gen/vocabulary.ts
var AGENT_EVENT_PREFIX = "agent_";
var AGENT_HOSTS = ["claude-code", "opencode", "codex", "gemini", "generic"];
var SETUP_SPEC = "counted.setup/1";
var AGENT_EVENTS = ["agent_session_start", "agent_session_end", "agent_tool_use", "agent_file_edit", "agent_command_run"];
var AGENT_EVENT_FIELDS = {
  "agent_session_start": {
    "model": {
      "type": "string",
      "optional": true,
      "maxLength": 120
    },
    "mode": {
      "type": "string",
      "optional": true,
      "maxLength": 40
    },
    "host": {
      "type": "enum",
      "values": [
        "claude-code",
        "opencode",
        "codex",
        "gemini",
        "generic"
      ]
    }
  },
  "agent_session_end": {
    "durationMs": {
      "type": "integer",
      "optional": true,
      "min": 0
    },
    "toolUseCount": {
      "type": "integer",
      "optional": true,
      "min": 0
    },
    "fileEditCount": {
      "type": "integer",
      "optional": true,
      "min": 0
    }
  },
  "agent_tool_use": {
    "tool": {
      "type": "string",
      "maxLength": 80
    },
    "outcome": {
      "type": "enum",
      "values": [
        "success",
        "error",
        "denied"
      ]
    },
    "durationMs": {
      "type": "integer",
      "optional": true,
      "min": 0
    }
  },
  "agent_file_edit": {
    "path": {
      "type": "string",
      "maxLength": 400
    },
    "action": {
      "type": "enum",
      "values": [
        "create",
        "edit",
        "delete"
      ]
    },
    "language": {
      "type": "string",
      "optional": true,
      "maxLength": 40
    }
  },
  "agent_command_run": {
    "command": {
      "type": "string",
      "maxLength": 64
    },
    "exitCode": {
      "type": "integer",
      "optional": true
    }
  }
};
var AGENT_CONTEXT_FIELDS = {
  "setupHash": {
    "type": "string",
    "maxLength": 64
  },
  "setupSpec": {
    "type": "string",
    "maxLength": 40
  },
  "setupHostSpec": {
    "type": "string",
    "maxLength": 60
  },
  "model": {
    "type": "string",
    "optional": true,
    "maxLength": 120
  },
  "setupLabel": {
    "type": "string",
    "optional": true,
    "maxLength": 80
  }
};
var checkField = (name, spec, value) => {
  if (value === void 0 || value === null) {
    return spec.optional === true ? null : `${name} is required`;
  }
  if (spec.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) return `${name} must be an integer`;
    if (spec.min !== void 0 && value < spec.min) return `${name} must be at least ${spec.min}`;
    return null;
  }
  if (typeof value !== "string") return `${name} must be a string`;
  if (spec.type === "enum") {
    return spec.values.includes(value) ? null : `${name} must be one of ${spec.values.join(", ")}`;
  }
  if (spec.maxLength !== void 0 && value.length > spec.maxLength) {
    return `${name} must be at most ${spec.maxLength} characters`;
  }
  return null;
};
var checkAgainst = (spec, properties) => {
  const problems = [];
  for (const [name, field] of Object.entries(spec)) {
    const problem = checkField(name, field, properties[name]);
    if (problem !== null) problems.push(problem);
  }
  for (const name of Object.keys(properties)) {
    if (!(name in spec)) problems.push(`${name} is not a property of this event`);
  }
  return problems;
};
var isAgentEventName = (name) => AGENT_EVENTS.includes(name);
var claimsAgentVocabulary = (name) => name.startsWith(AGENT_EVENT_PREFIX);
var validateAgentEvent = (name, properties = {}) => {
  if (!claimsAgentVocabulary(name)) return null;
  if (!isAgentEventName(name)) {
    return { event: name, problems: [`${name} is not in the agent vocabulary`] };
  }
  const problems = checkAgainst(AGENT_EVENT_FIELDS[name], properties);
  return problems.length === 0 ? null : { event: name, problems };
};
var validateAgentContext = (context) => {
  const problems = checkAgainst(AGENT_CONTEXT_FIELDS, context);
  return problems.length === 0 ? null : { event: "context", problems };
};

// ../agent-core/src/fingerprint.ts
import { createHash } from "crypto";
var sha256 = (content) => createHash("sha256").update(content, "utf8").digest("hex");
var canonicalize = (value) => {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("a setup projection cannot contain a non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== void 0).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  throw new Error(`a setup projection cannot contain ${typeof value}`);
};
var normalize = (projection) => ({
  ...projection,
  prompts: [...projection.prompts].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  tools: {
    ...projection.tools,
    allow: [...projection.tools.allow].sort(),
    deny: [...projection.tools.deny].sort()
  }
});
var setupFingerprint = (projection, hostSpecVersion = 1) => ({
  setupHash: sha256(canonicalize(normalize(projection))).slice(0, 16),
  setupSpec: projection.spec,
  setupHostSpec: `${projection.spec}+${projection.host}${hostSpecVersion === 1 ? "" : `/${hostSpecVersion}`}`
});
var emptyProjection = (host) => ({
  spec: SETUP_SPEC,
  host,
  model: null,
  prompts: [],
  tools: { allow: [], deny: [], mode: null },
  sampling: { temperature: null, topP: null, reasoningEffort: null }
});

// ../agent-core/src/redaction.ts
var LANGUAGES = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  ex: "elixir",
  exs: "elixir",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "css",
  html: "html",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml"
};
var langOf = (filePath) => {
  const base = filePath.split("/").pop() ?? filePath;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return void 0;
  const ext = base.slice(dot + 1).toLowerCase();
  return LANGUAGES[ext] ?? ext;
};
var relPath = (filePath, cwd) => {
  if (cwd !== void 0 && cwd.length > 0 && filePath.startsWith(cwd)) {
    const relative = filePath.slice(cwd.length).replace(/^\/+/, "");
    if (relative.length > 0) return scrubSecrets(relative);
  }
  return scrubSecrets(filePath.split("/").pop() ?? filePath);
};
var cmdName = (command) => {
  const first = command.trim().split(/\s+/)[0] ?? "";
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
    const rest = command.trim().split(/\s+/).find((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
    return (rest ?? "").split("/").pop() ?? "";
  }
  return first.split("/").pop() ?? first;
};
var SECRETS = [
  // Counted.
  /\b(?:ck|sk)_(?:live|test)_[A-Za-z0-9_-]{6,}/g,
  /\bck_[A-Za-z0-9_-]{12,}/g,
  // Common vendors, by their documented prefixes.
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  // A JWT, which is a bearer token wherever it turns up.
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  // `?token=…`, `&api_key=…` — a secret smuggled in a query string.
  /([?&](?:api[_-]?key|token|secret|password|access[_-]?token)=)[^&\s]+/gi
];
var scrubSecrets = (value) => {
  let out = value;
  for (const pattern of SECRETS) {
    out = out.replace(pattern, (_match, ...rest) => {
      const prefix = rest[0];
      return typeof prefix === "string" ? `${prefix}[redacted]` : "[redacted]";
    });
  }
  return out;
};
var truncate = (value, max) => value.length <= max ? value : `${value.slice(0, max - 1)}\u2026`;

// ../agent-core/src/tracker.ts
var NOOP_PROMISE = async () => {
};
var disabled = {
  enabled: false,
  track: () => {
  },
  registerSetup: () => {
  },
  sessionStart: () => {
  },
  sessionEnd: () => {
  },
  toolUse: () => {
  },
  fileEdit: () => {
  },
  commandRun: () => {
  },
  flush: NOOP_PROMISE,
  shutdown: NOOP_PROMISE
};
var defined = (value) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== void 0));
var createAgentTracker = (options) => {
  if (options.key === void 0 || options.key.trim().length === 0) return disabled;
  const strict = options.onInvalid ?? (process.env["NODE_ENV"] === "production" ? "drop" : "throw");
  const warn = options.onWarning ?? ((message) => void process.stderr.write(`counted: ${message}
`));
  const warned = /* @__PURE__ */ new Set();
  const client = new Counted(
    defined({
      key: options.key,
      endpoint: options.endpoint,
      // An agent session is explicit — it starts and ends when the host says
      // so — and can idle for an hour mid-task. Rolling the visit on idle
      // would split one session into several.
      visitId: options.sessionId,
      flushIntervalMs: options.flushIntervalMs ?? 1e4,
      fetch: options.fetch
    })
  );
  let context = {};
  const track = (name, properties) => {
    const cleaned = defined(properties);
    const problem = validateAgentEvent(name, cleaned);
    if (problem !== null) {
      const message = `${problem.event}: ${problem.problems.join("; ")}`;
      if (strict === "throw") throw new Error(`invalid agent event \u2014 ${message}`);
      if (!warned.has(name)) {
        warned.add(name);
        warn(`dropped ${message}`);
      }
      return;
    }
    client.track(name, { ...context, ...cleaned });
  };
  return {
    enabled: true,
    track,
    registerSetup: (projection, hostSpecVersion) => {
      const fingerprint = setupFingerprint(projection, hostSpecVersion);
      const next = {
        setupHash: fingerprint.setupHash,
        setupSpec: fingerprint.setupSpec,
        setupHostSpec: fingerprint.setupHostSpec,
        ...projection.model === null ? {} : { model: projection.model },
        ...options.label === void 0 ? {} : { setupLabel: truncate(options.label, 80) }
      };
      const problem = validateAgentContext(next);
      if (problem !== null) {
        if (strict === "throw") throw new Error(`invalid agent context \u2014 ${problem.problems.join("; ")}`);
        warn(`ignored setup context \u2014 ${problem.problems.join("; ")}`);
        return;
      }
      context = next;
    },
    sessionStart: (props) => track("agent_session_start", defined({ ...props, host: options.host })),
    sessionEnd: (props) => track("agent_session_end", defined({ ...props })),
    toolUse: (props) => track(
      "agent_tool_use",
      defined({ ...props, tool: truncate(scrubSecrets(props.tool), 80) })
    ),
    fileEdit: (props) => {
      const path = truncate(relPath(props.filePath, props.cwd), 400);
      const language = langOf(props.filePath);
      track("agent_file_edit", defined({ path, action: props.action, language }));
    },
    commandRun: (props) => track(
      "agent_command_run",
      defined({ command: truncate(cmdName(props.command), 64), exitCode: props.exitCode })
    ),
    flush: () => client.flush(),
    shutdown: () => client.shutdown()
  };
};

// ../agent-cli/dist/index.js
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
var str = (value) => typeof value === "string" && value.length > 0 ? value : void 0;
var num = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
var obj = (value) => typeof value === "object" && value !== null ? value : {};
var empty = (host) => ({
  sessionId: void 0,
  cwd: void 0,
  model: void 0,
  actions: [],
  setup: null
});
var claudeCode = (input) => {
  const event = str(input["hook_event_name"]);
  const sessionId = str(input["session_id"]);
  const cwd = str(input["cwd"]);
  const model = str(input["model"]);
  const base = { sessionId, cwd, model, setup: null };
  if (event === "SessionStart") {
    return { ...base, actions: [{ kind: "session_start", model, mode: str(input["source"]) }] };
  }
  if (event === "SessionEnd") {
    return { ...base, actions: [{ kind: "session_end" }] };
  }
  if (event === "PostToolUse" || event === "PostToolUseFailure") {
    const failed = event === "PostToolUseFailure";
    const tool = str(input["tool_name"]) ?? "unknown";
    const toolInput = obj(input["tool_input"]);
    const actions = [{ kind: "tool_use", tool, outcome: failed ? "error" : "success" }];
    const filePath = str(toolInput["file_path"]);
    if (filePath !== void 0 && (tool === "Write" || tool === "Edit" || tool === "MultiEdit")) {
      actions.push({ kind: "file_edit", filePath, action: tool === "Write" ? "create" : "edit" });
    }
    const command = str(toolInput["command"]);
    if (command !== void 0 && tool === "Bash") {
      actions.push({ kind: "command_run", command, ...failed ? { exitCode: 1 } : {} });
    }
    return { ...base, actions };
  }
  return { ...empty("claude-code"), sessionId, cwd, model };
};
var stdinShaped = (host) => (input) => {
  const sessionId = str(input["session_id"] ?? input["sessionId"] ?? input["conversation_id"]);
  const cwd = str(input["cwd"] ?? input["workspace"]);
  const model = str(input["model"]);
  const type = str(input["type"] ?? input["event"] ?? input["hook_event_name"]);
  const base = { sessionId, cwd, model, setup: null };
  if (type === "session_start" || type === "SessionStart" || type === "start") {
    return { ...base, actions: [{ kind: "session_start", model, mode: str(input["mode"]) }] };
  }
  if (type === "session_end" || type === "SessionEnd" || type === "stop") {
    return { ...base, actions: [{ kind: "session_end", durationMs: num(input["duration_ms"]) }] };
  }
  if (type === "tool_use" || type === "tool_call" || type === "PostToolUse") {
    const tool = str(input["tool"] ?? input["tool_name"]) ?? "unknown";
    const args = obj(input["args"] ?? input["tool_input"] ?? input["arguments"]);
    const failed = input["success"] === false || num(input["exit_code"]) === 1 || str(input["outcome"]) === "error";
    const denied = str(input["outcome"]) === "denied" || input["permission_denied"] === true;
    const actions = [
      { kind: "tool_use", tool, outcome: denied ? "denied" : failed ? "error" : "success" }
    ];
    const filePath = str(args["file_path"] ?? args["filePath"] ?? args["path"]);
    if (filePath !== void 0) {
      const action = str(args["action"]);
      actions.push({
        kind: "file_edit",
        filePath,
        action: action === "create" || action === "delete" ? action : "edit"
      });
    }
    const command = str(args["command"] ?? args["cmd"]);
    if (command !== void 0) {
      actions.push({ kind: "command_run", command, exitCode: num(input["exit_code"]) });
    }
    return { ...base, actions };
  }
  return { ...empty(host), sessionId, cwd, model };
};
var HOSTS = {
  "claude-code": claudeCode,
  codex: stdinShaped("codex"),
  gemini: stdinShaped("gemini"),
  generic: stdinShaped("generic"),
  // OpenCode does not run a hook process; it loads an in-process plugin, which
  // is why it has a package and these hosts do not. Reading a stdin event for
  // it would be answering a question nobody asks.
  opencode: () => empty("opencode")
};
var readSafe = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return void 0;
  }
};
var HOST_SPEC_VERSION = {
  "claude-code": 1,
  opencode: 1,
  codex: 1,
  gemini: 1,
  generic: 1
};
var claudeCodeProjection = (cwd, model, permissionMode) => {
  const prompts = [];
  const claudeMd = readSafe(join(cwd, "CLAUDE.md"));
  if (claudeMd !== void 0) prompts.push({ id: "CLAUDE.md", sha256: sha256(claudeMd) });
  try {
    for (const file of readdirSync(join(cwd, ".claude", "agents")).sort()) {
      const content = readSafe(join(cwd, ".claude", "agents", file));
      if (content !== void 0) prompts.push({ id: `.claude/agents/${file}`, sha256: sha256(content) });
    }
  } catch {
  }
  let allow = [];
  let deny = [];
  try {
    const settings = readSafe(join(cwd, ".claude", "settings.json"));
    if (settings !== void 0) {
      const permissions = JSON.parse(settings).permissions;
      allow = Array.isArray(permissions?.allow) ? permissions.allow.filter((v) => typeof v === "string") : [];
      deny = Array.isArray(permissions?.deny) ? permissions.deny.filter((v) => typeof v === "string") : [];
    }
  } catch {
  }
  return {
    ...emptyProjection("claude-code"),
    model: model ?? null,
    prompts,
    tools: { allow, deny, mode: permissionMode ?? null },
    // Claude Code hooks do not expose sampling parameters. `null` says "this
    // host cannot tell you", which is different from "it was unset" only in
    // that we are honest about which.
    sampling: { temperature: null, topP: null, reasoningEffort: null }
  };
};
var cachePath = (host, sessionId) => join(tmpdir(), `counted-setup-${host}-${sessionId.replace(/[^\w.-]/g, "_")}.json`);
var projectionFor = (host, cwd, model, mode) => host === "claude-code" ? claudeCodeProjection(cwd, model, mode) : { ...emptyProjection(host), model: model ?? null, tools: { allow: [], deny: [], mode: mode ?? null } };
var compute = (host, cwd, model, mode) => {
  const projection = projectionFor(host, cwd, model, mode);
  return { projection, fingerprint: setupFingerprint(projection, HOST_SPEC_VERSION[host]) };
};
var resolveSetup = (host, sessionId, cwd, model, mode, first) => {
  if (sessionId === void 0) return compute(host, cwd, model, mode);
  const path = cachePath(host, sessionId);
  if (!first) {
    const cached = readSafe(path);
    if (cached !== void 0) {
      try {
        return JSON.parse(cached);
      } catch {
      }
    }
    return compute(host, cwd, void 0, mode);
  }
  const setup = compute(host, cwd, model, mode);
  try {
    writeFileSync(path, JSON.stringify(setup));
  } catch {
  }
  return setup;
};
var DEFAULT_ENDPOINT = "https://api.counted.dev/v1/events";
var isAgentHost = (value) => AGENT_HOSTS.includes(value);
var parseHost = (argv) => {
  const index = argv.indexOf("--host");
  const value = index === -1 ? void 0 : argv[index + 1];
  return value !== void 0 && isAgentHost(value) ? value : "generic";
};
var readKey = (env) => env["COUNTED_AGENT_KEY"] ?? env["CLAUDE_PLUGIN_OPTION_API_KEY"];
var readEndpoint = (env) => env["COUNTED_AGENT_ENDPOINT"] ?? env["CLAUDE_PLUGIN_OPTION_ENDPOINT"] ?? DEFAULT_ENDPOINT;
var handle = async (input, deps) => {
  const host = parseHost(deps.argv);
  const reading = HOSTS[host](input);
  const key = readKey(deps.env);
  if (key === void 0 || key.trim().length === 0) {
    if (reading.actions.some((a) => a.kind === "session_start")) {
      deps.warn("no project key found (set the plugin's api_key, or COUNTED_AGENT_KEY) \u2014 analytics disabled");
    }
    return;
  }
  if (reading.actions.length === 0) return;
  const tracker = createAgentTracker({
    key,
    host,
    endpoint: readEndpoint(deps.env),
    sessionId: reading.sessionId,
    label: deps.env["COUNTED_SETUP_LABEL"],
    // A hook process lives for one event, so buffering to batch would mean
    // discarding on exit. Flushed explicitly below instead.
    flushIntervalMs: 6e4,
    // Never throw into a host, whatever NODE_ENV happens to say here: this
    // process is inside somebody's agent session.
    onInvalid: "drop",
    onWarning: deps.warn,
    fetch: deps.fetch
  });
  if (!tracker.enabled) return;
  const startsSession = reading.actions.some((a) => a.kind === "session_start");
  const setup = resolveSetup(
    host,
    reading.sessionId,
    reading.cwd ?? deps.cwd(),
    reading.model,
    typeof input["permission_mode"] === "string" ? input["permission_mode"] : void 0,
    startsSession
  );
  tracker.registerSetup(setup.projection);
  const cwd = reading.cwd ?? deps.cwd();
  for (const action of reading.actions) apply(tracker, action, cwd);
  await tracker.shutdown();
};
var apply = (tracker, action, cwd) => {
  switch (action.kind) {
    case "session_start":
      tracker.sessionStart({ model: action.model, mode: action.mode });
      return;
    case "session_end":
      tracker.sessionEnd({
        durationMs: action.durationMs,
        toolUseCount: action.toolUseCount,
        fileEditCount: action.fileEditCount
      });
      return;
    case "tool_use":
      tracker.toolUse({ tool: action.tool, outcome: action.outcome, durationMs: action.durationMs });
      return;
    case "file_edit":
      tracker.fileEdit({ filePath: action.filePath, action: action.action, cwd });
      return;
    case "command_run":
      tracker.commandRun({ command: action.command, exitCode: action.exitCode });
  }
};
var readStdin = async (stream) => {
  let raw = "";
  for await (const chunk of stream) raw += chunk;
  return raw;
};
var main = async (deps, stdin) => {
  const raw = await readStdin(stdin);
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }
  await handle(input, deps);
};

// src/hook.ts
var killer = setTimeout(() => process.exit(0), 4e3);
if (typeof killer.unref === "function") killer.unref();
main(
  {
    env: process.env,
    argv: ["--host", "claude-code"],
    cwd: () => process.cwd(),
    warn: (message) => void process.stderr.write(`counted: ${message}
`)
  },
  process.stdin
).catch(() => {
}).finally(() => {
  clearTimeout(killer);
  process.exit(0);
});
