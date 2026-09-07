/**
 * The bundled prefix table: decode once, then binary-search per event.
 *
 * The file is a delta-encoded partition of both address spaces. Every entry
 * says "from this address up to the next entry, this country", and the gaps
 * carry a country index of 0, meaning nobody has been delegated it. That shape
 * is what makes a lookup one binary search with no range-end comparison and no
 * fallthrough case: the search always lands somewhere, and somewhere is either
 * a country or the honest absence of one.
 *
 * ### Why it is a binary file and not a TypeScript array
 *
 * 286,000 boundaries. As source that is a nine-megabyte module the type checker
 * would walk on every build; as delta-encoded varints it is under a megabyte,
 * and it decodes into two typed arrays in a few milliseconds at startup. The
 * decoded form is `Uint32Array` + `Float64Array` — contiguous, no per-entry
 * object, so the search is cache-friendly and allocates nothing per event.
 *
 * ### Why IPv6 is keyed on 48 bits
 *
 * Registry delegations are /48 or shorter — three records in the whole dataset
 * are longer, and the generator drops them rather than widening them onto space
 * that belongs to somebody else. So the top 48 bits identify the delegation
 * exactly, and 48 bits is the largest integer that is still exact in a double.
 * A BigInt key would be correct and would allocate on every event.
 *
 * ### The format, which the generator writes and this reads
 *
 *     "CTRY" 0x01                     magic and version
 *     u32   generatedAt               unix seconds
 *     u16   countryCount              index 0 is reserved for "unknown"
 *     ...   countryCount * 2 ASCII    alpha-2 codes, commonest first
 *     u32   v4Count
 *     ...   v4Count * varint(delta) varint(countryIndex)
 *     u32   v6Count
 *     ...   v6Count * varint(delta) varint(countryIndex)
 *
 * `scripts/build-country-table.ts` is the only writer. A format change has to
 * land in both files, and `MAGIC` is what makes half a change fail loudly.
 */

export const MAGIC = "CTRY";
export const VERSION = 1;

export type CountryTable = {
  /** When the registry snapshot was taken. Read by the adapter's staleness log. */
  readonly generatedAt: Date;
  readonly countries: readonly string[];
  readonly v4Starts: Uint32Array;
  readonly v4Country: Uint16Array;
  readonly v6Starts: Float64Array;
  readonly v6Country: Uint16Array;
};

class Reader {
  #at = 0;
  readonly #bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  u8(): number {
    if (this.#at >= this.#bytes.length) throw new Error("country table is truncated");
    return this.#bytes[this.#at++] as number;
  }

  u16(): number {
    return this.u8() | (this.u8() << 8);
  }

  u32(): number {
    // Multiplication rather than `<<`, which would make anything past 2^31 negative.
    return this.u16() + this.u16() * 0x10000;
  }

  ascii(length: number): string {
    let text = "";
    for (let i = 0; i < length; i += 1) text += String.fromCharCode(this.u8());
    return text;
  }

  varint(): number {
    let value = 0;
    let scale = 1;
    for (;;) {
      const byte = this.u8();
      value += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) return value;
      scale *= 0x80;
    }
  }
}

const readAxis = (
  reader: Reader,
  starts: Float64Array | Uint32Array,
  countries: Uint16Array,
  count: number,
): void => {
  let previous = 0;
  for (let i = 0; i < count; i += 1) {
    previous += reader.varint();
    starts[i] = previous;
    countries[i] = reader.varint();
  }
};

export const decodeCountryTable = (bytes: Uint8Array): CountryTable => {
  const reader = new Reader(bytes);
  if (reader.ascii(4) !== MAGIC) throw new Error("not a country table");
  const version = reader.u8();
  if (version !== VERSION) {
    throw new Error(`country table is version ${version}; this build reads ${VERSION}`);
  }

  const generatedAt = new Date(reader.u32() * 1000);

  const countryCount = reader.u16();
  const countries: string[] = [];
  for (let i = 0; i < countryCount; i += 1) countries.push(reader.ascii(2));

  const v4Count = reader.u32();
  const v4Starts = new Uint32Array(v4Count);
  const v4Country = new Uint16Array(v4Count);
  readAxis(reader, v4Starts, v4Country, v4Count);

  const v6Count = reader.u32();
  const v6Starts = new Float64Array(v6Count);
  const v6Country = new Uint16Array(v6Count);
  readAxis(reader, v6Starts, v6Country, v6Count);

  return { generatedAt, countries, v4Starts, v4Country, v6Starts, v6Country };
};

/**
 * The index of the last boundary at or below `key`, or -1 if the table is empty.
 *
 * Written out rather than delegated to a helper because it runs once per event
 * and because the invariant it depends on — boundaries strictly increasing and
 * starting at zero — is asserted by the adapter's own test rather than assumed.
 */
const floorIndex = (starts: Float64Array | Uint32Array, key: number): number => {
  let low = 0;
  let high = starts.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if ((starts[middle] as number) <= key) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
};

/**
 * The country an address key falls in, or `null`.
 *
 * `null` covers three genuinely different situations and deliberately does not
 * distinguish them: address space nobody has been delegated, a private or
 * loopback range, and a block the registries record against the European Union
 * rather than a country. All three answer the same question the same way —
 * we do not know which country this is — and inventing a bucket for any of them
 * would put a row in a breakdown that a reader would take for a place.
 */
export const countryOfKey = (table: CountryTable, address: { family: 4 | 6; key: number }): string | null => {
  const starts = address.family === 4 ? table.v4Starts : table.v6Starts;
  const codes = address.family === 4 ? table.v4Country : table.v6Country;

  const at = floorIndex(starts, address.key);
  if (at < 0) return null;

  const index = codes[at] as number;
  if (index === 0) return null;
  return table.countries[index - 1] ?? null;
};
