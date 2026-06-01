// Computes the agent "setup fingerprint" for Claude Code. Because hooks run as
// a separate process per event, the model (only present on SessionStart) and
// the resulting hash are cached to a per-session temp file so every later event
// carries the same setupHash. Only the digest is ever sent — CLAUDE.md, agent
// definitions, and settings are hashed locally, never transmitted.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setupFingerprint } from "@counted/sdk";

export type Setup = {
  model?: string;
  setupHash: string;
  setupHashVersion: number;
  setupLabel?: string;
};

function readSafe(p: string): string | undefined {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

// The deliberate, versioned input set: model + prompts (CLAUDE.md, agent defs) +
// tools/permissions. No sampling params — Claude Code hooks don't expose them.
function gatherInputs(cwd: string, model: string | undefined, permissionMode: string | undefined) {
  const claudeMd = readSafe(join(cwd, "CLAUDE.md"));
  const agents: Record<string, string> = {};
  try {
    for (const f of readdirSync(join(cwd, ".claude", "agents")).sort()) {
      const c = readSafe(join(cwd, ".claude", "agents", f));
      if (c) agents[f] = c;
    }
  } catch {
    /* no agents dir */
  }

  let permissions: unknown;
  try {
    const settings = readSafe(join(cwd, ".claude", "settings.json"));
    if (settings) permissions = JSON.parse(settings).permissions;
  } catch {
    /* unparseable settings */
  }

  return {
    model,
    permissionMode,
    prompts: { claudeMd, agents },
    tools: { permissions },
  };
}

const cachePath = (sessionId: string) =>
  join(tmpdir(), `counted-setup-${sessionId.replace(/[^\w.-]/g, "_")}.json`);

function compute(cwd: string, sessionId: string, model: string | undefined, permissionMode: string | undefined): Setup {
  const { setupHash, setupHashVersion } = setupFingerprint(gatherInputs(cwd, model, permissionMode));
  const setup: Setup = { model, setupHash, setupHashVersion };
  const label = process.env.COUNTED_SETUP_LABEL;
  if (label) setup.setupLabel = label;
  try {
    writeFileSync(cachePath(sessionId), JSON.stringify(setup));
  } catch {
    /* tmp not writable — fingerprint still works for this event */
  }
  return setup;
}

/** SessionStart: compute with the model and cache for the rest of the session. */
export function computeAndCacheSetup(cwd: string, sessionId: string, model: string | undefined, permissionMode: string | undefined): Setup {
  return compute(cwd, sessionId, model, permissionMode);
}

/** Later events: reuse the cached setup; if absent (enabled mid-session), recompute without the model. */
export function loadSetup(cwd: string, sessionId: string, permissionMode: string | undefined): Setup {
  try {
    return JSON.parse(readFileSync(cachePath(sessionId), "utf8")) as Setup;
  } catch {
    return compute(cwd, sessionId, undefined, permissionMode);
  }
}

/** Setup fields as event context, dropping any undefined. */
export function setupContext(setup: Setup): Record<string, string | number> {
  const ctx: Record<string, string | number> = {
    setupHash: setup.setupHash,
    setupHashVersion: setup.setupHashVersion,
  };
  if (setup.model) ctx.model = setup.model;
  if (setup.setupLabel) ctx.setupLabel = setup.setupLabel;
  return ctx;
}
