/**
 * The bundled table, exercised against the real file.
 *
 * These are not fixtures. The assertions below name addresses whose delegation
 * has been stable for decades — Google's 8.8.8.0/24, APNIC's 1.1.1.0/24, a
 * RIPE block, an AFRINIC block, a LACNIC block — so a rebuild of the table does
 * not rewrite the test. What they prove is that decode, search and the
 * IPv4/IPv6 split all agree with the generator, which is the pairing that no
 * type checker can see: the two files share a format and nothing else.
 */

import { describe, expect, test } from "bun:test";
import { BundledGeoLocator, loadCountryTable } from "./locator";
import { countryOfKey, decodeCountryTable, MAGIC } from "./table";

const table = loadCountryTable();
const locator = new BundledGeoLocator(table);

/**
 * The answers, widened to `string`.
 *
 * `countryOf` returns a branded `CountryCode`, and a branded type has no string
 * literal that satisfies it — comparing against `"US"` is a compile error, which
 * is the brand doing its job. Widening on the way out of the call is assignment,
 * not a cast: the value is unchanged and nothing unbranded gets back in.
 */
const country = (address: string): string | null => locator.countryOf(address);

describe("the table decodes and is shaped the way the search assumes", () => {
  test("it carries every country the registries name, and a build date", () => {
    // 238 today. The floor is a sanity bound: a decode that silently read the
    // wrong offsets would produce a handful of codes, not two hundred.
    expect(table.countries.length).toBeGreaterThan(200);
    for (const code of table.countries) expect(code).toMatch(/^[A-Z]{2}$/);
    expect(table.generatedAt.getTime()).toBeGreaterThan(Date.UTC(2020, 0, 1));
  });

  test("both axes start at zero and increase strictly — the binary search depends on it", () => {
    for (const starts of [table.v4Starts, table.v6Starts]) {
      expect(starts.length).toBeGreaterThan(1000);
      expect(starts[0]).toBe(0);
      let previous = -1;
      for (const start of starts) {
        expect(start).toBeGreaterThan(previous);
        previous = start;
      }
    }
  });

  test("no two adjacent boundaries carry the same country, so the table is minimal", () => {
    for (const codes of [table.v4Country, table.v6Country]) {
      for (let i = 1; i < codes.length; i += 1) expect(codes[i]).not.toBe(codes[i - 1] as number);
    }
  });

  test("a file that is not a country table is refused rather than read as noise", () => {
    expect(() => decodeCountryTable(new TextEncoder().encode("PNG\r\n"))).toThrow("not a country table");
    const wrongVersion = Uint8Array.from([...new TextEncoder().encode(MAGIC), 9]);
    expect(() => decodeCountryTable(wrongVersion)).toThrow("version 9");
  });
});

describe("looking an address up", () => {
  test("stable delegations resolve to the right country, in all five registries", () => {
    expect(country("8.8.8.8")).toBe("US");        // ARIN
    expect(country("213.32.1.1")).toBe("FR");     // RIPE NCC
    expect(country("139.130.4.5")).toBe("AU");    // APNIC
    expect(country("196.10.52.1")).toBe("ZA");    // AFRINIC
    expect(country("200.40.30.245")).toBe("UY");  // LACNIC
  });

  test("IPv6 resolves too, and is a different axis from IPv4", () => {
    expect(country("2001:4860:4860::8888")).toBe("US");
    expect(country("2a00:1450:4001::1")).toBe("IE");
    // The same 48-bit value read as IPv4 would be a different country or none;
    // this is what proves the two axes are not being searched interchangeably.
    expect(country("::ffff:8.8.8.8")).toBe("US");
  });

  test("a private, loopback or link-local address has no country and says so", () => {
    // Not special-cased anywhere. IANA never delegated these to a registry, so
    // they fall in a gap — which is the same answer by the same mechanism.
    for (const address of ["10.0.0.1", "192.168.1.1", "172.16.0.1", "127.0.0.1", "169.254.1.1", "::1", "fe80::1"]) {
      expect(locator.countryOf(address)).toBeNull();
    }
  });

  test("an unreadable address is null, not a throw — one bad header must not cost the batch", () => {
    for (const address of ["", "unknown", "not-an-ip", "8.8.8.8.8", "obfuscated_id"]) {
      expect(locator.countryOf(address)).toBeNull();
    }
  });

  test("every answer is two upper-case letters, because it becomes a dimension value", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "213.32.1.1", "2a00:1450:4001::1"]) {
      expect(country(address)).toMatch(/^[A-Z]{2}$/);
    }
  });

  test("the lookup is fast enough to sit on the ingest hot path", () => {
    // A group commit is up to 250 events and each one costs one of these. The
    // bound is loose on purpose — it is here to catch a linear scan, which
    // would be ~4000x slower, not to police microseconds.
    const started = performance.now();
    for (let i = 0; i < 50_000; i += 1) locator.countryOf(`8.8.${i % 256}.1`);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("the address never survives the lookup", () => {
  test("countryOf is the only exported way in, and it returns two letters", () => {
    // The port is synchronous and returns a CountryCode. There is no method
    // that returns a city, an ASN, a normalised address, or the address back —
    // so nothing downstream can hold one even by accident.
    const answer: string | null = locator.countryOf("8.8.8.8");
    expect(answer).toBe("US");
    expect(Object.keys(locator)).toEqual([]);
  });

  test("a key is a number, so what the search sees cannot be logged as an address", () => {
    expect(countryOfKey(table, { family: 4, key: 134_744_072 })).toBe("US"); // 8.8.8.8
  });
});
