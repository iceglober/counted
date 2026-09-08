/**
 * Build the bundled IP → country table from the five RIRs' delegated statistics.
 *
 * Run by hand, not by CI:
 *
 *     bun run geo:build            # downloads, then writes the table
 *     bun run geo:build --cache …  # reuse already-downloaded files
 *
 * **Why the RIRs and not a geolocation vendor.** The registries publish which
 * organisation in which country holds each block, under terms that permit
 * redistribution — so the table can live in a public MIT repo with no attribution
 * clause bolted onto the licence and no per-lookup network call. A commercial
 * database would be more precise about *where in a country* an address is, which
 * is a question this product deliberately never asks: the only geography Counted
 * stores is a two-letter code.
 *
 * **What that costs, stated plainly.** Registry data is allocation-level. An
 * address inside a block a multinational carrier registered in one country reads
 * as that country wherever the customer physically is, and an address behind a
 * VPN reads as the exit node's country. Country-level registry lookup is right
 * roughly 97-99% of the time and is systematically wrong for large roaming
 * carriers. It is a coarse, honest slice — not a location.
 *
 * **The output is committed and never drift-checked.** The registries republish
 * daily, so a `git diff --exit-code` against a fresh download would fail every
 * morning for reasons nobody caused. Rebuild it deliberately; the header carries
 * the date it was built so the age is readable.
 *
 * Format — see `packages/ingestion/adapter-geoip/src/table.ts`, which decodes it.
 * The two must agree; they share the magic bytes and nothing else, so a format
 * change that only lands in one of them fails the adapter's own test rather than
 * a query six weeks later.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SOURCES: Readonly<Record<string, string>> = {
  arin: "https://ftp.arin.net/pub/stats/arin/delegated-arin-extended-latest",
  ripencc: "https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-extended-latest",
  apnic: "https://ftp.apnic.net/stats/apnic/delegated-apnic-extended-latest",
  lacnic: "https://ftp.lacnic.net/pub/stats/lacnic/delegated-lacnic-extended-latest",
  afrinic: "https://ftp.afrinic.net/pub/stats/afrinic/delegated-afrinic-extended-latest",
};

/**
 * The one alpha-2 code in the registry data that is not a country.
 *
 * ISO 3166-1 reserves `EU` for the European Union, and ARIN and RIPE use it for
 * a handful of legacy blocks held across the union. Ten IPv4 ranges today. They
 * become "unknown" rather than a bucket named after a continent, because a
 * breakdown row labelled `EU` next to `DE` and `FR` reads as a country and is not.
 */
const NOT_A_COUNTRY = new Set(["EU"]);

/** Longer than a /48 and the top-48 key would claim space belonging to somebody else. */
const V6_KEY_BITS = 48;

type Range = { readonly start: number; readonly span: number; readonly cc: string };

const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });
/** ICU echoes the input back when it does not know the region. */
const isRealRegion = (code: string): boolean => REGION_NAMES.of(code) !== code;

const parseIpv4 = (address: string): number | null => {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
};

const parseIpv6 = (address: string): bigint | null => {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] === undefined || halves[0] === "" ? [] : halves[0].split(":");
  const right = halves[1] === undefined || halves[1] === "" ? [] : halves[1].split(":");
  const hextets =
    halves.length === 1
      ? left
      : [...left, ...new Array<string>(8 - left.length - right.length).fill("0"), ...right];
  if (hextets.length !== 8) return null;
  let value = 0n;
  for (const hextet of hextets) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(hextet)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(hextet, 16));
  }
  return value;
};

const readRecords = (text: string): { v4: Range[]; v6: Range[]; skipped: number } => {
  const v4: Range[] = [];
  const v6: Range[] = [];
  let skipped = 0;

  for (const line of text.split("\n")) {
    if (line.length === 0 || line.startsWith("#")) continue;
    const fields = line.split("|");
    if (fields.length < 7) continue;

    const [, cc, type, start, value, , status] = fields;
    if (status !== "allocated" && status !== "assigned") continue;
    if (cc === undefined || !/^[A-Z]{2}$/.test(cc) || NOT_A_COUNTRY.has(cc) || !isRealRegion(cc)) {
      skipped += 1;
      continue;
    }
    if (start === undefined || value === undefined) continue;

    if (type === "ipv4") {
      // `value` is a COUNT of addresses here, not a prefix length, and it is not
      // always a power of two — a registry may delegate 1536 addresses.
      const base = parseIpv4(start);
      const span = Number(value);
      if (base === null || !Number.isInteger(span) || span <= 0) { skipped += 1; continue; }
      v4.push({ start: base, span, cc });
    } else if (type === "ipv6") {
      // Here `value` IS a prefix length. Different meaning, same column.
      const bits = Number(value);
      if (!Number.isInteger(bits) || bits < 1 || bits > 128) { skipped += 1; continue; }
      if (bits > V6_KEY_BITS) { skipped += 1; continue; }
      const base = parseIpv6(start);
      if (base === null) { skipped += 1; continue; }
      v6.push({
        start: Number(base >> BigInt(128 - V6_KEY_BITS)),
        span: 2 ** (V6_KEY_BITS - bits),
        cc,
      });
    }
  }

  return { v4, v6, skipped };
};

/**
 * Turn overlapping-or-not ranges into a strictly increasing boundary list that
 * partitions the whole space: every entry says "from here up to the next entry,
 * this country", and gaps carry the empty code.
 *
 * Overlaps are truncated rather than merged. They should not occur across
 * registries and the count is printed, because a rising number would mean the
 * upstream data changed shape.
 */
const toBoundaries = (
  ranges: readonly Range[],
): { boundaries: { start: number; cc: string }[]; overlaps: number } => {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.span - b.span);
  const boundaries: { start: number; cc: string }[] = [];
  let overlaps = 0;
  let cursor = 0;

  for (const range of sorted) {
    const start = Math.max(range.start, cursor);
    const end = range.start + range.span;
    if (end <= cursor) { overlaps += 1; continue; }
    if (start > range.start) overlaps += 1;

    if (start > cursor) boundaries.push({ start: cursor, cc: "" });
    boundaries.push({ start, cc: range.cc });
    cursor = end;
  }

  // Everything above the last allocation is unknown, and the lookup needs a
  // boundary that says so rather than falling off the end of the array.
  boundaries.push({ start: cursor, cc: "" });
  if (boundaries[0]?.start !== 0) boundaries.unshift({ start: 0, cc: "" });

  const merged: { start: number; cc: string }[] = [];
  for (const boundary of boundaries) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.cc === boundary.cc) continue;
    if (last !== undefined && last.start === boundary.start) { merged[merged.length - 1] = boundary; continue; }
    merged.push(boundary);
  }
  return { boundaries: merged, overlaps };
};

class Writer {
  #bytes: number[] = [];

  u8(value: number): void { this.#bytes.push(value & 0xff); }
  u16(value: number): void { this.u8(value); this.u8(value >>> 8); }
  u32(value: number): void { this.u16(value & 0xffff); this.u16(Math.floor(value / 0x10000)); }
  ascii(text: string): void { for (const ch of text) this.u8(ch.charCodeAt(0)); }

  /** LEB128. Number-based, so it is exact up to 2^53 and every value here is under 2^48. */
  varint(value: number): void {
    let rest = value;
    while (rest >= 0x80) {
      this.u8((rest % 0x80) + 0x80);
      rest = Math.floor(rest / 0x80);
    }
    this.u8(rest);
  }

  toBuffer(): Uint8Array { return Uint8Array.from(this.#bytes); }
}

const main = async (): Promise<void> => {
  const cacheFlag = process.argv.indexOf("--cache");
  const cache = cacheFlag === -1 ? join(process.cwd(), ".geo-cache") : (process.argv[cacheFlag + 1] as string);
  mkdirSync(cache, { recursive: true });

  const v4: Range[] = [];
  const v6: Range[] = [];
  let skipped = 0;

  for (const [registry, url] of Object.entries(SOURCES)) {
    const path = join(cache, `${registry}.txt`);
    if (!existsSync(path)) {
      process.stdout.write(`fetching ${registry}… `);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${registry}: ${response.status} ${response.statusText}`);
      writeFileSync(path, await response.text());
      process.stdout.write("done\n");
    }
    const records = readRecords(readFileSync(path, "utf8"));
    v4.push(...records.v4);
    v6.push(...records.v6);
    skipped += records.skipped;
    console.log(`${registry}: ${records.v4.length} ipv4, ${records.v6.length} ipv6`);
  }

  const four = toBoundaries(v4);
  const six = toBoundaries(v6);

  // Commonest countries get the lowest indices, so their varint is one byte.
  const frequency = new Map<string, number>();
  for (const boundary of [...four.boundaries, ...six.boundaries]) {
    if (boundary.cc === "") continue;
    frequency.set(boundary.cc, (frequency.get(boundary.cc) ?? 0) + 1);
  }
  const codes = [...frequency.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([cc]) => cc);
  const index = new Map(codes.map((cc, at) => [cc, at + 1]));

  const writer = new Writer();
  writer.ascii("CTRY");
  writer.u8(1);
  writer.u32(Math.floor(Date.now() / 1000));
  writer.u16(codes.length);
  for (const cc of codes) writer.ascii(cc);

  for (const boundaries of [four.boundaries, six.boundaries]) {
    writer.u32(boundaries.length);
    let previous = 0;
    for (const boundary of boundaries) {
      writer.varint(boundary.start - previous);
      writer.varint(boundary.cc === "" ? 0 : (index.get(boundary.cc) as number));
      previous = boundary.start;
    }
  }

  const out = join(process.cwd(), "packages/ingestion/adapter-geoip/data/ip-country.bin");
  const buffer = writer.toBuffer();
  writeFileSync(out, buffer);

  console.log("");
  console.log(`countries        ${codes.length}`);
  console.log(`ipv4 boundaries  ${four.boundaries.length} (${four.overlaps} overlaps truncated)`);
  console.log(`ipv6 boundaries  ${six.boundaries.length} (${six.overlaps} overlaps truncated)`);
  console.log(`records skipped  ${skipped}`);
  console.log(`wrote            ${out} — ${(buffer.length / 1024).toFixed(0)} KiB`);
};

await main();
