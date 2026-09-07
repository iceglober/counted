/**
 * One machine is one `os_name`.
 *
 * v1 stored whatever the SDK sent. Four SDKs each had their own spelling —
 * `macOS` from JavaScript, `darwin` from Go, `Mac OS X` scraped off a
 * user-agent, `macos` from Rust — and all four landed in the same column. A
 * breakdown by operating system showed macOS four times with the traffic split
 * between them, and no query could put it back together because the column
 * held four distinct dictionary values.
 *
 * The SDKs now send the canonical value (`packages/sdk-js/src/platform.ts`),
 * but that only fixes events sent by an SDK new enough to do it. Versions in
 * the wild keep sending the old spellings for years, and curl sends whatever
 * somebody typed. So the collapse happens here too, at admission, where it
 * applies to every event however it arrived.
 *
 * The raw value is kept as `os_name_raw` rather than discarded. Without it a
 * misrouted platform is invisible: `os_name` says `other` and there is nothing
 * to say what the client actually claimed, so nobody can add the alias.
 */

/**
 * The closed set. `other` is a member, not a failure — a value outside the set
 * has to become *something*, and inventing a new dictionary entry per unknown
 * spelling is how the column fragments in the first place.
 */
export const OS_NAMES = [
  "macos",
  "windows",
  "linux",
  "ios",
  "ipados",
  "android",
  "tvos",
  "watchos",
  "visionos",
  "chromeos",
  "freebsd",
  "other",
] as const;

export type OsName = (typeof OS_NAMES)[number];

export const isOsName = (value: unknown): value is OsName =>
  typeof value === "string" && (OS_NAMES as readonly string[]).includes(value);

/**
 * Aliases, keyed by the *folded* spelling — lowercased with spaces,
 * underscores, hyphens and dots removed. Folding first is what makes one entry
 * cover `Mac OS X`, `mac-os-x`, `MAC_OS_X` and `macosx` instead of four.
 *
 * This table must agree with `osAliases` in `contract/gen/contract.json`,
 * which is the source the four SDKs are generated from. It is duplicated here
 * rather than imported because a domain package may import nothing outside its
 * own context — see `domain-is-pure`. The generator should emit this file; it
 * does not yet, and `os-name.test.ts` pins every entry so a silent divergence
 * fails a test rather than a dashboard.
 */
const OS_ALIASES: Readonly<Record<string, OsName>> = {
  macos: "macos",
  macosx: "macos",
  mac: "macos",
  darwin: "macos",
  osx: "macos",
  windows: "windows",
  win: "windows",
  win32: "windows",
  win64: "windows",
  winnt: "windows",
  linux: "linux",
  gnulinux: "linux",
  ubuntu: "linux",
  debian: "linux",
  fedora: "linux",
  arch: "linux",
  ios: "ios",
  iphoneos: "ios",
  iphone: "ios",
  ipados: "ipados",
  ipad: "ipados",
  android: "android",
  tvos: "tvos",
  appletvos: "tvos",
  watchos: "watchos",
  visionos: "visionos",
  xros: "visionos",
  chromeos: "chromeos",
  chromiumos: "chromeos",
  cros: "chromeos",
  freebsd: "freebsd",
  openbsd: "freebsd",
  netbsd: "freebsd",
  other: "other",
  unknown: "other",
};

/** Lowercase, and drop the separators people disagree about. */
const fold = (raw: string): string => raw.toLowerCase().replace(/[\s._-]/g, "");

export type CanonicalOsName = {
  readonly osName: OsName;
  /**
   * What the client sent, when it differed from the canonical value.
   *
   * `null` when the client already sent the canonical spelling or sent
   * nothing. Storing `os_name_raw: "macos"` beside `os_name: "macos"` is a
   * column of noise; storing `"Mac OS X"` beside `"macos"` is the audit trail
   * that lets somebody see the alias fired.
   */
  readonly osNameRaw: string | null;
};

/**
 * Collapse one spelling to one canonical name.
 *
 * Total: any input, including nothing at all, yields a member of `OS_NAMES`.
 * An event with no platform is `other`, never a hole — a null in a dimension
 * column is a bucket queries have to special-case forever.
 */
export const canonicalOsName = (raw: string | null | undefined): CanonicalOsName => {
  if (raw === null || raw === undefined) return { osName: "other", osNameRaw: null };

  const trimmed = raw.trim();
  if (trimmed.length === 0) return { osName: "other", osNameRaw: null };

  const osName = OS_ALIASES[fold(trimmed)] ?? "other";
  return { osName, osNameRaw: trimmed === osName ? null : trimmed };
};
