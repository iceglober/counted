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

write("packages/sdk-js/src/gen/contract.ts", typescript(source));
