/**
 * Everything that decides what an agent event is allowed to say.
 *
 * One copy. There were four — `relPath`, `cmdName` and `langOf` were pasted
 * into each host package, so a fix to one left the others leaking. A test
 * asserts no adapter declares them again.
 *
 * The rule these implement: an agent integration reports *shape*, never
 * content. Which tool, which outcome, which file — never the diff, never the
 * arguments, never the output.
 */

/** Extension → language. Unknown extensions pass through as themselves. */
const LANGUAGES: Readonly<Record<string, string>> = {
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
  toml: "toml",
};

export const langOf = (filePath: string): string | undefined => {
  const base = filePath.split("/").pop() ?? filePath;
  // A dotfile with no extension — `.env`, `.gitignore` — is not a `.env`
  // language. `slice(1)` on it would report the filename as the extension.
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return undefined;
  const ext = base.slice(dot + 1).toLowerCase();
  return LANGUAGES[ext] ?? ext;
};

/**
 * A path safe to send: relative to the repo, or a bare filename.
 *
 * Falling back to the basename rather than the absolute path is deliberate. An
 * absolute path carries the home directory, which carries a username.
 */
export const relPath = (filePath: string, cwd?: string | undefined): string => {
  if (cwd !== undefined && cwd.length > 0 && filePath.startsWith(cwd)) {
    const relative = filePath.slice(cwd.length).replace(/^\/+/, "");
    if (relative.length > 0) return scrubSecrets(relative);
  }
  return scrubSecrets(filePath.split("/").pop() ?? filePath);
};

/** The binary, without its path or arguments. `/usr/bin/git push` → `git`. */
export const cmdName = (command: string): string => {
  const first = command.trim().split(/\s+/)[0] ?? "";
  // `FOO=bar cmd` — an inline environment assignment is not the command, and
  // its value is exactly the kind of thing that should not be sent.
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
    const rest = command.trim().split(/\s+/).find((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
    return (rest ?? "").split("/").pop() ?? "";
  }
  return first.split("/").pop() ?? first;
};

/**
 * Patterns that look like a credential wherever they appear.
 *
 * Counted's own key prefixes are in here on purpose: an agent editing a `.env`
 * must not be able to exfiltrate a key through a *file path*, and the most
 * embarrassing version of that bug is leaking our own.
 *
 * Ordered longest-prefix-first, because `sk_live_…` must not be half-matched
 * by a shorter rule and left partly intact.
 */
const SECRETS: readonly RegExp[] = [
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
  /([?&](?:api[_-]?key|token|secret|password|access[_-]?token)=)[^&\s]+/gi,
];

/**
 * Replace anything that looks like a credential with `[redacted]`.
 *
 * Applied to every string that leaves an integration, not only to the ones
 * expected to contain one. The cost of running it on a tool name is nothing;
 * the cost of not running it on the one field nobody thought about is a
 * published secret.
 */
export const scrubSecrets = (value: string): string => {
  let out = value;
  for (const pattern of SECRETS) {
    out = out.replace(pattern, (_match: string, ...rest: unknown[]) => {
      // A pattern with a capture group keeps it, so `?token=` stays readable.
      // The type check is load-bearing: with no group, `rest[0]` is the match
      // *offset* — a number — and testing it against `undefined` prepended the
      // offset to every redaction.
      const prefix = rest[0];
      return typeof prefix === "string" ? `${prefix}[redacted]` : "[redacted]";
    });
  }
  return out;
};

/** Longest a redacted string may be. Beyond this it is a payload, not a name. */
export const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;
