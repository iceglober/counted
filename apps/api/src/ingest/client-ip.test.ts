/**
 * Which entry of `X-Forwarded-For` is the client, and why it is not the first.
 *
 * Every test here is really one question: can a caller decide what country its
 * own events are attributed to? The ingest endpoint takes a public key from a
 * browser, so "a caller" is anybody on the internet, and reading the leftmost
 * entry — the common implementation — makes the answer yes.
 */

import { describe, expect, test } from "bun:test";
import { clientAddress, DEFAULT_TRUSTED_PROXY_HOPS, FORWARDED_FOR } from "./client-ip";

const forwarded = (value: string): Headers => new Headers({ [FORWARDED_FOR]: value });

describe("one trusted proxy, which is the deployed topology", () => {
  test("the single entry is the client, because the edge wrote it", () => {
    expect(clientAddress(forwarded("203.0.113.7"), 1)).toBe("203.0.113.7");
  });

  test("a client that forges the header cannot choose its own country", () => {
    // The caller sent `X-Forwarded-For: 1.2.3.4`; the edge appended the address
    // it actually saw. Reading from the right takes the edge's word and
    // discards the client's.
    expect(clientAddress(forwarded("1.2.3.4, 203.0.113.7"), 1)).toBe("203.0.113.7");
    // A whole forged chain does not help either — however many it invents, the
    // real one is still last.
    expect(clientAddress(forwarded("1.2.3.4, 5.6.7.8, 9.9.9.9, 203.0.113.7"), 1)).toBe("203.0.113.7");
  });

  test("whitespace around entries is trimmed, because the header is comma-space separated", () => {
    expect(clientAddress(forwarded("  203.0.113.7  "), 1)).toBe("203.0.113.7");
    expect(clientAddress(forwarded("1.2.3.4 ,  203.0.113.7 "), 1)).toBe("203.0.113.7");
  });
});

describe("more than one trusted proxy", () => {
  test("two hops reads past the CDN's own egress address", () => {
    // `client, cdn-egress`: the platform edge appended the CDN's address, and
    // the CDN appended the client's. Two trusted appenders, so count two back.
    expect(clientAddress(forwarded("203.0.113.7, 198.51.100.9"), 2)).toBe("203.0.113.7");
  });

  test("a chain shorter than the configured hops is refused, not guessed at", () => {
    // The request did not come through the proxies the operator described. The
    // only entry available is the client's own claim, and using it would be
    // exactly the hole the hop count exists to close.
    expect(clientAddress(forwarded("203.0.113.7"), 2)).toBeNull();
    expect(clientAddress(forwarded("203.0.113.7, 198.51.100.9"), 3)).toBeNull();
  });
});

describe("no address is available", () => {
  test("no header at all is no country", () => {
    expect(clientAddress(new Headers(), 1)).toBeNull();
  });

  test("zero hops turns geography off, whatever the header says", () => {
    // For an install where nothing in front is trusted to set the header. The
    // honest answer there is no country, not whatever the client typed.
    expect(clientAddress(forwarded("203.0.113.7"), 0)).toBeNull();
    expect(clientAddress(forwarded("1.2.3.4, 203.0.113.7"), 0)).toBeNull();
  });

  test("a nonsensical hop count is treated as zero rather than as a default", () => {
    // A silently-substituted default would be a deployment believing it trusts
    // no proxy while trusting one.
    for (const hops of [-1, 1.5, Number.NaN]) {
      expect(clientAddress(forwarded("1.2.3.4, 203.0.113.7"), hops)).toBeNull();
    }
  });

  test("an empty entry in the position we want is null, not an empty string", () => {
    expect(clientAddress(forwarded("1.2.3.4, "), 1)).toBeNull();
    expect(clientAddress(forwarded(""), 1)).toBeNull();
  });
});

test("the default is one hop: the platform edge", () => {
  expect(DEFAULT_TRUSTED_PROXY_HOPS).toBe(1);
});

test("the entry is returned unparsed — one definition of what an address is", () => {
  // Validation belongs to the geo adapter's `addressKey`, which also handles
  // ports, brackets and zone ids. Doing it here too would be two answers to
  // one question.
  expect(clientAddress(forwarded("[2606:4700::1]:443"), 1)).toBe("[2606:4700::1]:443");
  expect(clientAddress(forwarded("obfuscated_hostname"), 1)).toBe("obfuscated_hostname");
});
