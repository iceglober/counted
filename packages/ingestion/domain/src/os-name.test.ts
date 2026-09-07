import { describe, expect, test } from "bun:test";

import { canonicalOsName, isOsName, OS_NAMES, type OsName } from "./os-name";

describe("canonicalOsName", () => {
  test("the four spellings v1's SDKs sent for one platform collapse to one", () => {
    // The actual bug: macOS appeared four times in a breakdown, traffic split
    // between the rows, and no query could reunite them.
    const spellings = ["macOS", "darwin", "Mac OS X", "macos"];
    const collapsed = new Set(spellings.map((raw) => canonicalOsName(raw).osName));
    expect(collapsed).toEqual(new Set(["macos"]));
  });

  test("the raw spelling survives whenever it differed", () => {
    expect(canonicalOsName("Mac OS X")).toEqual({ osName: "macos", osNameRaw: "Mac OS X" });
    expect(canonicalOsName("darwin")).toEqual({ osName: "macos", osNameRaw: "darwin" });
  });

  test("an already-canonical value carries no raw, because that column would be noise", () => {
    expect(canonicalOsName("macos")).toEqual({ osName: "macos", osNameRaw: null });
  });

  test("an unrecognised platform is `other` and keeps what it claimed", () => {
    // Without the raw value there is no way to learn the alias is missing.
    expect(canonicalOsName("SerenityOS")).toEqual({ osName: "other", osNameRaw: "SerenityOS" });
  });

  test("folding makes separators and case irrelevant", () => {
    for (const raw of ["WIN32", "win_32", "win-32", "Win 32", "win.32"]) {
      expect(canonicalOsName(raw).osName).toBe("windows");
    }
  });

  test("absent, empty and whitespace-only all become `other` with no raw", () => {
    for (const raw of [null, undefined, "", "   "]) {
      expect(canonicalOsName(raw)).toEqual({ osName: "other", osNameRaw: null });
    }
  });

  test("it is total: every input lands inside the closed set", () => {
    const inputs = ["", "??", "Linux", "\u0000", "a".repeat(500), "OTHER", "unknown"];
    for (const raw of inputs) expect(isOsName(canonicalOsName(raw).osName)).toBe(true);
  });

  test("every canonical name is its own alias, so a well-behaved SDK is never rewritten", () => {
    for (const name of OS_NAMES) {
      expect(canonicalOsName(name)).toEqual({ osName: name, osNameRaw: null });
    }
  });
});

describe("the alias table agrees with contract/gen/contract.json", () => {
  // Pinned by hand because the domain may not read a file and may not import
  // the generated SDK constants. If `contract:generate` ever emits this table
  // into the domain, delete this test and compare the modules instead.
  const PINNED: Readonly<Record<string, OsName>> = {
    macos: "macos", macosx: "macos", mac: "macos", darwin: "macos", osx: "macos",
    windows: "windows", win: "windows", win32: "windows", win64: "windows", winnt: "windows",
    linux: "linux", gnulinux: "linux", ubuntu: "linux", debian: "linux", fedora: "linux", arch: "linux",
    ios: "ios", iphoneos: "ios", iphone: "ios",
    ipados: "ipados", ipad: "ipados",
    android: "android",
    tvos: "tvos", appletvos: "tvos",
    watchos: "watchos",
    visionos: "visionos", xros: "visionos",
    chromeos: "chromeos", chromiumos: "chromeos", cros: "chromeos",
    freebsd: "freebsd", openbsd: "freebsd", netbsd: "freebsd",
    other: "other", unknown: "other",
  };

  test("every alias in the contract resolves to the contract's canonical name", () => {
    for (const [alias, expected] of Object.entries(PINNED)) {
      expect(canonicalOsName(alias).osName).toBe(expected);
    }
  });

  test("the canonical set matches the contract's osNames, in order", () => {
    expect([...OS_NAMES]).toEqual([
      "macos", "windows", "linux", "ios", "ipados", "android",
      "tvos", "watchos", "visionos", "chromeos", "freebsd", "other",
    ]);
  });
});
