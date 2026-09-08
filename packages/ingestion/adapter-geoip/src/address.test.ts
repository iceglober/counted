import { describe, expect, test } from "bun:test";
import { addressKey } from "./address";

const v4 = (a: number, b: number, c: number, d: number): number =>
  ((a * 256 + b) * 256 + c) * 256 + d;

describe("IPv4", () => {
  test("a dotted quad becomes its unsigned 32-bit value", () => {
    expect(addressKey("8.8.8.8")).toEqual({ family: 4, key: v4(8, 8, 8, 8) });
    expect(addressKey("0.0.0.0")).toEqual({ family: 4, key: 0 });
    // Past 2^31. A `<<`-based parser returns a negative number here and every
    // comparison against the table's unsigned starts goes the wrong way.
    expect(addressKey("255.255.255.255")).toEqual({ family: 4, key: 4_294_967_295 });
    expect(addressKey("223.255.255.255")).toEqual({ family: 4, key: v4(223, 255, 255, 255) });
  });

  test("a port is stripped, because proxies write one and it is not the address", () => {
    expect(addressKey("8.8.8.8:51000")).toEqual({ family: 4, key: v4(8, 8, 8, 8) });
  });

  test("surrounding whitespace is trimmed, because X-Forwarded-For is comma-space separated", () => {
    expect(addressKey("  8.8.8.8  ")).toEqual({ family: 4, key: v4(8, 8, 8, 8) });
  });

  test("a malformed quad is refused rather than partly read", () => {
    for (const bad of ["8.8.8", "8.8.8.8.8", "8.8.8.256", "8.8.8.-1", "8.8.8.0x1", "8. 8.8.8", ""]) {
      expect(addressKey(bad)).toBeNull();
    }
  });
});

describe("IPv6", () => {
  test("the key is the top 48 bits, which is what registry delegations are", () => {
    expect(addressKey("2001:4860:4860::8888")).toEqual({
      family: 6,
      key: 0x2001 * 0x100000000 + 0x4860 * 0x10000 + 0x4860,
    });
    // Two addresses inside one /48 have one key, which is the whole point.
    expect(addressKey("2001:4860:4860::8888")).toEqual(addressKey("2001:4860:4860:ffff::1"));
    expect(addressKey("2001:4860:4861::1")).not.toEqual(addressKey("2001:4860:4860::1"));
  });

  test("`::` expands from either side and in the middle", () => {
    expect(addressKey("::")).toEqual({ family: 6, key: 0 });
    expect(addressKey("2001::")).toEqual({ family: 6, key: 0x2001 * 0x100000000 });
    expect(addressKey("2001:0db8:0000:0000:0000:0000:0000:0001")).toEqual(addressKey("2001:db8::1"));
  });

  test("brackets and a port are stripped", () => {
    expect(addressKey("[2606:4700::1]:443")).toEqual(addressKey("2606:4700::1"));
    expect(addressKey("[2606:4700::1]")).toEqual(addressKey("2606:4700::1"));
  });

  test("a zone id is a local interface name, not part of the address", () => {
    expect(addressKey("fe80::1%eth0")).toEqual(addressKey("fe80::1"));
  });

  test("an IPv4-mapped address is answered from the IPv4 table, where the address actually is", () => {
    expect(addressKey("::ffff:8.8.8.8")).toEqual({ family: 4, key: v4(8, 8, 8, 8) });
    expect(addressKey("::ffff:808:808")).toEqual({ family: 4, key: v4(8, 8, 8, 8) });
  });

  test("the deprecated IPv4-compatible form is NOT folded, because ::1 lives in it", () => {
    // Reading ::1 as 0.0.0.1 would be a wrong answer wearing a right one's
    // clothes: a v4 key that lands in unallocated space rather than the
    // loopback it is.
    expect(addressKey("::1")).toEqual({ family: 6, key: 0 });
  });

  test("a malformed address is refused", () => {
    for (const bad of ["2001::db8::1", "2001:db8:1", "gggg::1", "2001:db8::1::", "::ffff:8.8.8"]) {
      expect(addressKey(bad)).toBeNull();
    }
  });
});

test("an implausibly long string is refused before it is parsed", () => {
  expect(addressKey("1.".repeat(200) + "1")).toBeNull();
});
