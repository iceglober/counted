// Stable fingerprint of an agent "setup" (models, prompts, tools, sampling).
// The digest — not the inputs — is what you send, so prompt content never
// leaves the machine. Bump SETUP_HASH_VERSION when the canonical input set
// changes so old and new fingerprints don't silently mix.

export const SETUP_HASH_VERSION = 1;

// Order-independent canonical form: keys sorted recursively, null/undefined
// dropped. Same logical config -> same string regardless of key order.
function canonical(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      const v = canonical(src[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return value;
}

// FNV-1a-style 64-bit digest as 16 hex chars, in two decorrelated 32-bit lanes.
// Not cryptographic — just a stable, low-collision bucket key. Pure JS so it
// works in the browser and Node alike (the SDK stays zero-dependency).
function hash64(str: string): string {
  let a = 0x811c9dc5;
  let b = 0xc2b2ae35;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/**
 * Hash an agent setup into a stable id. Pass whatever defines the setup —
 * e.g. `{ model, prompts, tools, sampling }`. Returns the digest plus the
 * scheme version. Register the result as context so it rides on every event.
 */
export function setupFingerprint(input: Record<string, unknown>): {
  setupHash: string;
  setupHashVersion: number;
} {
  return {
    setupHash: hash64(JSON.stringify(canonical(input))),
    setupHashVersion: SETUP_HASH_VERSION,
  };
}
