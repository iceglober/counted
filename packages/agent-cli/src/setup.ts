/**
 * Reading a host's configuration off the machine, and remembering it.
 *
 * Two problems here, both caused by hooks being a process per event.
 *
 * The configuration is only fully visible on the first event of a session —
 * Claude Code passes the model on `SessionStart` and nowhere else — so the
 * fingerprint is computed once and cached to a per-session temp file. Without
 * that, every later event in the session would carry a different setup hash
 * than the first, and a breakdown by setup would show one session as several.
 *
 * And the content is hashed here, on the machine. `CLAUDE.md`, agent
 * definitions and settings are read, digested, and discarded. What leaves is
 * `{id, sha256}` — enough to tell *that* a prompt changed, and which one,
 * without ever seeing it.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  emptyProjection,
  setupFingerprint,
  sha256,
  type AgentHost,
  type Fingerprint,
  type PromptDigest,
  type SetupProjection,
} from "@counted/agent-core";

const readSafe = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

/**
 * How this host's configuration maps into the projection.
 *
 * Bump when the mapping changes — when a field starts being read from
 * somewhere else, or a new one is included. It only invalidates comparison
 * *within* this host, which is the whole reason it is separate from the spec
 * version.
 */
const HOST_SPEC_VERSION: Readonly<Record<AgentHost, number>> = {
  "claude-code": 1,
  opencode: 1,
  codex: 1,
  gemini: 1,
  generic: 1,
};

const claudeCodeProjection = (cwd: string, model: string | undefined, permissionMode: string | undefined): SetupProjection => {
  const prompts: PromptDigest[] = [];

  const claudeMd = readSafe(join(cwd, "CLAUDE.md"));
  if (claudeMd !== undefined) prompts.push({ id: "CLAUDE.md", sha256: sha256(claudeMd) });

  try {
    for (const file of readdirSync(join(cwd, ".claude", "agents")).sort()) {
      const content = readSafe(join(cwd, ".claude", "agents", file));
      if (content !== undefined) prompts.push({ id: `.claude/agents/${file}`, sha256: sha256(content) });
    }
  } catch {
    /* no agents directory — a setup with no sub-agents, not an error */
  }

  let allow: string[] = [];
  let deny: string[] = [];
  try {
    const settings = readSafe(join(cwd, ".claude", "settings.json"));
    if (settings !== undefined) {
      const permissions = (JSON.parse(settings) as { permissions?: { allow?: unknown; deny?: unknown } }).permissions;
      allow = Array.isArray(permissions?.allow) ? permissions.allow.filter((v): v is string => typeof v === "string") : [];
      deny = Array.isArray(permissions?.deny) ? permissions.deny.filter((v): v is string => typeof v === "string") : [];
    }
  } catch {
    /* unparseable settings — report the setup without them rather than nothing */
  }

  return {
    ...emptyProjection("claude-code"),
    model: model ?? null,
    prompts,
    tools: { allow, deny, mode: permissionMode ?? null },
    // Claude Code hooks do not expose sampling parameters. `null` says "this
    // host cannot tell you", which is different from "it was unset" only in
    // that we are honest about which.
    sampling: { temperature: null, topP: null, reasoningEffort: null },
  };
};

/** Everything the tracker needs to stamp on the session's events. */
export type CachedSetup = {
  readonly projection: SetupProjection;
  readonly fingerprint: Fingerprint;
};

const cachePath = (host: AgentHost, sessionId: string): string =>
  join(tmpdir(), `counted-setup-${host}-${sessionId.replace(/[^\w.-]/g, "_")}.json`);

export const projectionFor = (
  host: AgentHost,
  cwd: string,
  model: string | undefined,
  mode: string | undefined,
): SetupProjection =>
  host === "claude-code"
    ? claudeCodeProjection(cwd, model, mode)
    : { ...emptyProjection(host), model: model ?? null, tools: { allow: [], deny: [], mode: mode ?? null } };

const compute = (host: AgentHost, cwd: string, model: string | undefined, mode: string | undefined): CachedSetup => {
  const projection = projectionFor(host, cwd, model, mode);
  return { projection, fingerprint: setupFingerprint(projection, HOST_SPEC_VERSION[host]) };
};

/**
 * The session's setup: computed on the first event, reused on the rest.
 *
 * `first` is the caller's judgement about whether this event can see the whole
 * configuration. On a later event the cache is authoritative even if the
 * config has since changed on disk — a session's events must all report the
 * setup the session started with, or the breakdown counts one session twice.
 */
export const resolveSetup = (
  host: AgentHost,
  sessionId: string | undefined,
  cwd: string,
  model: string | undefined,
  mode: string | undefined,
  first: boolean,
): CachedSetup => {
  if (sessionId === undefined) return compute(host, cwd, model, mode);
  const path = cachePath(host, sessionId);

  if (!first) {
    const cached = readSafe(path);
    if (cached !== undefined) {
      try {
        return JSON.parse(cached) as CachedSetup;
      } catch {
        /* corrupt cache — recompute below, without the model this host only
           reveals on the first event */
      }
    }
    // Enabled mid-session, or the temp file was swept. Recomputing without the
    // model is right: claiming a model nobody told us would be a fabrication.
    return compute(host, cwd, undefined, mode);
  }

  const setup = compute(host, cwd, model, mode);
  try {
    writeFileSync(path, JSON.stringify(setup));
  } catch {
    /* tmp not writable — the fingerprint is still correct for this event */
  }
  return setup;
};
