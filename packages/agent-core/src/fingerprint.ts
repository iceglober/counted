/**
 * The setup fingerprint.
 *
 * A digest of how an agent was configured — model, prompts, tools, sampling —
 * so a user can ask "which of my setups produces fewer failed tool calls?"
 * without any of the configuration leaving the machine.
 *
 * **The bug this replaces.** `setupHashVersion: 1` meant two different things.
 * Claude Code hashed `{model, permissionMode, prompts:{claudeMd, agents},
 * tools:{permissions}}`; OpenCode hashed `{model, agents, tools, permission,
 * provider, sampling}`. Same version number, incomparable inputs — so grouping
 * across hosts produced numbers that looked like data and were noise.
 *
 * The fix is that **adapters populate a canonical projection and core hashes
 * that**, rather than each adapter hashing its own host's config. A host that
 * cannot supply a field supplies `null`; it is never omitted, so the
 * canonicalization is stable and a missing field is distinguishable from an
 * absent one.
 *
 * Two version fields, because two different things change:
 *
 * - `setupSpec` — the projection's schema. Two hashes are comparable only
 *   within one spec, whatever host produced them.
 * - `setupHostSpec` — how one host's config maps into the projection. Bumping
 *   it says "this host now reads its config differently", which invalidates
 *   comparison within that host without touching anyone else.
 */

import { createHash } from "node:crypto";
import { SETUP_SPEC, type AgentHost } from "./gen/vocabulary";

export type PromptDigest = {
  /** What the prompt is — `CLAUDE.md`, `agents/reviewer.md`. Never content. */
  readonly id: string;
  /** sha256 of the content, computed here and sent instead of it. */
  readonly sha256: string;
};

export type SetupProjection = {
  readonly spec: typeof SETUP_SPEC;
  readonly host: AgentHost;
  readonly model: string | null;
  /** Sorted by id. Content is hashed locally and never transmitted. */
  readonly prompts: readonly PromptDigest[];
  readonly tools: {
    readonly allow: readonly string[];
    readonly deny: readonly string[];
    readonly mode: string | null;
  };
  readonly sampling: {
    readonly temperature: number | null;
    readonly topP: number | null;
    readonly reasoningEffort: string | null;
  };
};

export type Fingerprint = {
  readonly setupHash: string;
  readonly setupSpec: typeof SETUP_SPEC;
  /** `counted.setup/1+claude-code`. Comparable only within one host. */
  readonly setupHostSpec: string;
};

/** sha256 as hex. Content never leaves the machine — only this does. */
export const sha256 = (content: string): string => createHash("sha256").update(content, "utf8").digest("hex");

/**
 * Canonical JSON, in the sense RFC 8785 means it: object keys sorted by their
 * UTF-16 code units, no insignificant whitespace.
 *
 * `undefined` is not representable, and that is enforced rather than tolerated:
 * a projection that dropped a field instead of setting it `null` would hash the
 * same as one that never had it, which is exactly the ambiguity the `null`
 * convention exists to remove.
 */
export const canonicalize = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("a setup projection cannot contain a non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  throw new Error(`a setup projection cannot contain ${typeof value}`);
};

/**
 * Sort the parts of a projection whose order is not meaningful.
 *
 * Two machines listing the same agents in a different directory order describe
 * the same setup, and must fingerprint the same. Without this the hash would
 * report a configuration change every time a filesystem enumerated differently.
 */
const normalize = (projection: SetupProjection): SetupProjection => ({
  ...projection,
  prompts: [...projection.prompts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  tools: {
    ...projection.tools,
    allow: [...projection.tools.allow].sort(),
    deny: [...projection.tools.deny].sort(),
  },
});

/**
 * 16 hex characters of a sha256 over the canonical projection.
 *
 * Truncated because it is a grouping key, not a commitment: it labels rows in a
 * breakdown, and 64 bits is far past the point where two of a user's setups
 * collide.
 */
export const setupFingerprint = (projection: SetupProjection, hostSpecVersion = 1): Fingerprint => ({
  setupHash: sha256(canonicalize(normalize(projection))).slice(0, 16),
  setupSpec: projection.spec,
  setupHostSpec: `${projection.spec}+${projection.host}${hostSpecVersion === 1 ? "" : `/${hostSpecVersion}`}`,
});

/**
 * A projection with every field at its empty value.
 *
 * Adapters build on this so that adding a field to the projection is a
 * compile-time change in one place rather than five hosts silently omitting it
 * — which is the failure mode the `null`-not-omitted rule exists to prevent.
 */
export const emptyProjection = (host: AgentHost): SetupProjection => ({
  spec: SETUP_SPEC,
  host,
  model: null,
  prompts: [],
  tools: { allow: [], deny: [], mode: null },
  sampling: { temperature: null, topP: null, reasoningEffort: null },
});
