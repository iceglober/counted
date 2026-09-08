/**
 * `GeoLocator` over the bundled registry table.
 *
 * One `readFileSync` at construction, then a binary search per event. There is
 * no network call, no cache, no eviction and no timeout, because there is
 * nothing to wait for: the whole table is 950 KiB of address space in two typed
 * arrays, and a lookup is ~18 comparisons over contiguous memory.
 *
 * ### Why a file read, and why it is safe here
 *
 * A domain package may not touch `node:fs` — that is `domain-has-no-io`, and it
 * is the property that lets every rule in the system be tested with no
 * filesystem. An adapter is exactly the layer where that stops applying, and
 * the alternative is worse: the same data as a TypeScript literal is a
 * nine-megabyte module that the type checker walks on every build.
 *
 * ### What it costs to be wrong
 *
 * Registry data is allocation-level. An address inside a block a multinational
 * carrier registered in one country reads as that country wherever the person
 * physically is, and a VPN reads as its exit node. That is the accuracy this
 * product is buying with a lookup that never leaves the process and never sees
 * an address twice — and it is the reason the dimension is `country` and not
 * `city`. A country breakdown is a coarse, honest slice. It is not a location.
 *
 * ### Staleness
 *
 * The registries republish daily and the bundled table does not. A table that
 * is a year old still places the overwhelming majority of addresses correctly —
 * delegations are re-registered rarely — but blocks delegated since the build
 * read as `null`. `age` exposes that so a caller can log it once at startup,
 * which is the difference between an operator knowing the table is old and
 * discovering it from a chart.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { admitCountry, type CountryCode } from "@counted/ingestion-domain";
import type { GeoLocator } from "@counted/ingestion-ports";

import { addressKey } from "./address";
import { countryOfKey, decodeCountryTable, type CountryTable } from "./table";

/** Where the generated table lives, relative to this module. */
export const TABLE_PATH = fileURLToPath(new URL("../data/ip-country.bin", import.meta.url));

export const loadCountryTable = (path: string = TABLE_PATH): CountryTable =>
  decodeCountryTable(new Uint8Array(readFileSync(path)));

export class BundledGeoLocator implements GeoLocator {
  readonly #table: CountryTable;

  /**
   * Takes a decoded table rather than a path, so a test builds a three-row one
   * without a file and production loads the bundled one with `loadCountryTable`.
   */
  constructor(table: CountryTable) {
    this.#table = table;
  }

  static bundled(path?: string): BundledGeoLocator {
    return new BundledGeoLocator(loadCountryTable(path));
  }

  /** When the registry snapshot behind this table was taken. */
  get generatedAt(): Date {
    return this.#table.generatedAt;
  }

  countryOf(address: string): CountryCode | null {
    const key = addressKey(address);
    if (key === null) return null;
    // Back through `admitCountry` rather than cast: the table is generated and
    // could in principle carry a code that is not two upper-case letters, and
    // the brand is only meaningful if exactly one function can mint it.
    return admitCountry(countryOfKey(this.#table, key));
  }
}
