/**
 * Generate the per-language contract constants.
 *
 * The behaviour is hand-written in each language — a retry loop is not hard,
 * and four idiomatic ones beat one awkward shared one. What rots is the
 * **data**: enum values, defaults, backoff constants, status lists. So the
 * data is generated from one file and the generated output is committed, with
 * CI failing on any difference.
 *
 * Adding a language means adding an emitter here, not remembering to update a
 * fifth list by hand.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const source = JSON.parse(readFileSync(join(ROOT, "contract/gen/contract.json"), "utf8")) as Contract;

type Contract = {
  contractVersion: string;
  osNames: string[];
  osAliases: Record<string, string>;
  defaults: Record<string, number>;
  backoff: { baseMs: number; maxMs: number; factor: number; jitter: string };
  endpoints: Record<string, string>;
  retryableStatuses: number[];
  fatalStatuses: number[];
};

const BANNER = `Generated from contract/gen/contract.json. Do not edit.\nRun \`bun run contract:generate\` and commit the result.`;

const typescript = (c: Contract): string => `/**
 * ${BANNER.split("\n").join("\n * ")}
 */

export const CONTRACT_VERSION = ${JSON.stringify(c.contractVersion)} as const;

export const OS_NAMES = ${JSON.stringify(c.osNames)} as const;
export type OsName = (typeof OS_NAMES)[number];

/** Lowercased and stripped of spaces, underscores, hyphens and dots. */
export const OS_ALIASES: Readonly<Record<string, OsName>> = ${JSON.stringify(c.osAliases, null, 2)};

export const DEFAULTS = ${JSON.stringify(c.defaults, null, 2)} as const;

export const BACKOFF = ${JSON.stringify(c.backoff, null, 2)} as const;

export const ENDPOINTS = ${JSON.stringify(c.endpoints, null, 2)} as const;

/** Retry these when the server does not say whether to. */
export const RETRYABLE_STATUSES: readonly number[] = ${JSON.stringify(c.retryableStatuses)};

/** Never retry these. They mean a credential a developer has to fix. */
export const FATAL_STATUSES: readonly number[] = ${JSON.stringify(c.fatalStatuses)};
`;

const write = (relative: string, contents: string): void => {
  const path = join(ROOT, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  console.log(`wrote ${relative} (${contents.length} bytes)`);
};

const python = (c: Contract): string => `"""${BANNER.split("\n").join("\n")}"""

CONTRACT_VERSION = ${JSON.stringify(c.contractVersion)}

OS_NAMES = ${JSON.stringify(c.osNames)}

OS_ALIASES = ${JSON.stringify(c.osAliases, null, 4)}

DEFAULTS = ${JSON.stringify(c.defaults, null, 4)}

BACKOFF = ${JSON.stringify(c.backoff, null, 4)}

ENDPOINTS = ${JSON.stringify(c.endpoints, null, 4)}

RETRYABLE_STATUSES = ${JSON.stringify(c.retryableStatuses)}

FATAL_STATUSES = ${JSON.stringify(c.fatalStatuses)}
`;

const go = (c: Contract): string => `// ${BANNER.split("\n").join("\n// ")}

package counted

const ContractVersion = ${JSON.stringify(c.contractVersion)}

var OsNames = []string{${c.osNames.map((n) => JSON.stringify(n)).join(", ")}}

var OsAliases = map[string]string{
${Object.entries(c.osAliases).map(([k, v]) => `\t${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n")}
}

const (
${Object.entries(c.defaults).map(([k, v]) => `\t${k[0]!.toUpperCase()}${k.slice(1)} = ${v}`).join("\n")}
)

const (
\tBackoffBaseMs = ${c.backoff.baseMs}
\tBackoffMaxMs  = ${c.backoff.maxMs}
\tBackoffFactor = ${c.backoff.factor}
)

var RetryableStatuses = []int{${c.retryableStatuses.join(", ")}}

var FatalStatuses = []int{${c.fatalStatuses.join(", ")}}
`;

const rust = (c: Contract): string => `// ${BANNER.split("\n").join("\n// ")}

pub const CONTRACT_VERSION: &str = ${JSON.stringify(c.contractVersion)};

pub const OS_NAMES: [&str; ${c.osNames.length}] = [${c.osNames.map((n) => JSON.stringify(n)).join(", ")}];

pub const OS_ALIASES: [(&str, &str); ${Object.keys(c.osAliases).length}] = [
${Object.entries(c.osAliases).map(([k, v]) => `    (${JSON.stringify(k)}, ${JSON.stringify(v)}),`).join("\n")}
];

${Object.entries(c.defaults).map(([k, v]) => `pub const ${k.replace(/([A-Z])/g, "_$1").toUpperCase()}: u64 = ${v};`).join("\n")}

pub const BACKOFF_BASE_MS: u64 = ${c.backoff.baseMs};
pub const BACKOFF_MAX_MS: u64 = ${c.backoff.maxMs};
pub const BACKOFF_FACTOR: u64 = ${c.backoff.factor};

pub const RETRYABLE_STATUSES: [u16; ${c.retryableStatuses.length}] = [${c.retryableStatuses.join(", ")}];

pub const FATAL_STATUSES: [u16; ${c.fatalStatuses.length}] = [${c.fatalStatuses.join(", ")}];
`;

write("packages/sdk-js/src/gen/contract.ts", typescript(source));
write("packages/python/counted/_contract.py", python(source));
write("packages/go/contract_gen.go", go(source));
write("packages/rust/src/contract.rs", rust(source));
