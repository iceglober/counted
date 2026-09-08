/**
 * Reading an address off the wire, into the one number a lookup needs.
 *
 * This module never returns the address. It returns a *key* — an unsigned
 * integer — and that is the whole point: the caller gets something it can
 * binary-search and cannot log, print, hash or store as an identifier. The
 * string exists as an argument to one function and is unreachable after it
 * returns.
 *
 * What arrives here is not clean. `X-Forwarded-For` entries in the wild carry
 * ports (`1.2.3.4:51000`), brackets (`[2001:db8::1]:443`), IPv6 zone ids
 * (`fe80::1%eth0`), and addresses that are IPv4 wearing an IPv6 coat
 * (`::ffff:1.2.3.4`). All four are handled, because the alternative is that a
 * proxy nobody anticipated silently turns every event's country into null.
 *
 * Anything else is `null`. Not a guess, not a partial parse: an address we
 * cannot read is an address we do not know the country of, and `null` is
 * exactly that statement.
 */

/** The top bits of an IPv6 address that the bundled table is keyed by. */
export const V6_KEY_BITS = 48;

export type AddressKey =
  | { readonly family: 4; readonly key: number }
  | { readonly family: 6; readonly key: number };

const parseOctets = (text: string): number | null => {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // `Number("")` is 0 and `Number(" 1")` is 1, so the shape is checked first.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
};

/**
 * The top 48 bits of an IPv6 address.
 *
 * Assembled as a Number rather than a BigInt: 48 bits is exact in a double,
 * the table's keys are the same 48 bits, and a BigInt on the ingest hot path
 * would allocate per event for no gain.
 */
const parseV6Key = (text: string): AddressKey | null => {
  const halves = text.split("::");
  if (halves.length > 2) return null;

  const left = halves[0] === undefined || halves[0] === "" ? [] : halves[0].split(":");
  const right = halves[1] === undefined || halves[1] === "" ? [] : halves[1].split(":");

  // A trailing dotted quad — `::ffff:1.2.3.4` and `64:ff9b::1.2.3.4` — occupies
  // two hextets. Expanded here so the hextet arithmetic below stays uniform.
  const tail = right.length > 0 ? right : left;
  const last = tail[tail.length - 1];
  if (last !== undefined && last.includes(".")) {
    const packed = parseOctets(last);
    if (packed === null) return null;
    tail.splice(tail.length - 1, 1, (packed >>> 16).toString(16), (packed & 0xffff).toString(16));
  }

  const hextets =
    halves.length === 1
      ? left
      : [...left, ...new Array<string>(8 - left.length - right.length).fill("0"), ...right];
  if (hextets.length !== 8) return null;

  const words: number[] = [];
  for (const hextet of hextets) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(hextet)) return null;
    words.push(Number.parseInt(hextet, 16));
  }

  // ::ffff:0:0/96 is IPv4 in IPv6 clothing, and it is answered from the IPv4
  // table because that is where the address actually is. The deprecated
  // IPv4-compatible form (::/96) is deliberately NOT folded in: `::1` sits
  // inside it, and reading the loopback address as 0.0.0.1 would be a wrong
  // answer dressed as a right one.
  const mapped =
    words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0;
  if (mapped && words[5] === 0xffff) {
    return { family: 4, key: ((((words[6] as number) << 16) | (words[7] as number)) >>> 0) };
  }

  // Top 48 bits: three hextets.
  return {
    family: 6,
    key: (words[0] as number) * 0x100000000 + (words[1] as number) * 0x10000 + (words[2] as number),
  };
};

/**
 * Read one `X-Forwarded-For` entry.
 *
 * The port is stripped from an IPv4 entry but not sought in a bare IPv6 one:
 * `2001:db8::1` is all colons, and there is no way to tell a port from a
 * hextet without the brackets that RFC 3986 requires and that proxies omit.
 * A bracketed form gives us the answer unambiguously and is handled above.
 */
export const addressKey = (raw: string): AddressKey | null => {
  let text = raw.trim();
  if (text.length === 0 || text.length > 64) return null;

  // `[2001:db8::1]:443` and `[2001:db8::1]`.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(text);
  if (bracketed?.[1] !== undefined) text = bracketed[1];

  // A zone id is a local interface name. It says nothing about geography and
  // is not part of the address.
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);

  if (text.includes(":")) {
    // `1.2.3.4:5678` — one colon, and a dotted quad in front of it.
    const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(text);
    if (withPort?.[1] !== undefined) {
      const packed = parseOctets(withPort[1]);
      return packed === null ? null : { family: 4, key: packed >>> 0 };
    }
    return parseV6Key(text);
  }

  const packed = parseOctets(text);
  return packed === null ? null : { family: 4, key: packed >>> 0 };
};
