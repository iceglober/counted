import { describe, expect, test } from "bun:test";
import { admitCountry, isCountryCode } from "./country";

describe("admitCountry", () => {
  test("two letters, folded up", () => {
    expect(admitCountry("NZ")).toBe("NZ" as never);
    expect(admitCountry("nz")).toBe("NZ" as never);
    expect(admitCountry(" gb ")).toBe("GB" as never);
  });

  test("anything that is not two letters is refused, and an address most of all", () => {
    // The string this function must never accept. Truncating rather than
    // refusing would turn `19.…` into a code — a plausible-looking value with
    // an address behind it, which is the whole thing the derive-and-discard
    // design exists to prevent.
    for (const bad of ["203.0.113.7", "2001:db8::1", "USA", "U", "U1", "1S", "", "  ", "U-S"]) {
      expect(admitCountry(bad)).toBeNull();
    }
  });

  test("a non-string is refused rather than coerced", () => {
    for (const bad of [undefined, null, 42, true, {}, ["U", "S"]]) {
      expect(admitCountry(bad)).toBeNull();
    }
  });
});

test("isCountryCode does not fold — a brand is only meaningful if one function mints it", () => {
  expect(isCountryCode("NZ")).toBe(true);
  expect(isCountryCode("nz")).toBe(false);
  expect(isCountryCode("203.0.113.7")).toBe(false);
});
