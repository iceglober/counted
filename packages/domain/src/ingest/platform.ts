/**
 * Normalising the platform an event came from.
 *
 * v1 stored whatever each SDK happened to send, and the four SDKs disagreed:
 * `macOS`, `Mac OS X`, `darwin` and `macos` were four different values in the
 * same column, so a breakdown by operating system showed macOS four times with
 * the traffic split between them.
 *
 * Two rules make that unrepresentable:
 *
 *   1. The stored value is a **closed enum**. Anything unrecognised becomes
 *      `other` — it does not pass through.
 *   2. The raw value is kept alongside it. So a platform we have never seen is
 *      discoverable rather than lost, and the fix is a line in the table below
 *      rather than a migration.
 *
 * Unrecognised input also produces a warning on the receipt, which is the
 * difference between finding out now and finding out when someone asks why
 * their chart says `other`.
 */

export const PLATFORMS = [
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

export type Platform = (typeof PLATFORMS)[number];

/**
 * Every spelling seen in the wild, mapped.
 *
 * Keys are already lowercased and stripped of spaces, underscores and hyphens
 * before lookup, so `Mac OS X`, `mac-os-x` and `macosx` are one entry.
 */
const ALIASES: Readonly<Record<string, Platform>> = {
  macos: "macos",
  macosx: "macos",
  mac: "macos",
  darwin: "macos",
  osx: "macos",
  apple: "macos",

  windows: "windows",
  win: "windows",
  win32: "windows",
  win64: "windows",
  windowsnt: "windows",
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

const strip = (raw: string): string => raw.toLowerCase().replace(/[\s_\-.]/g, "");

export type PlatformReading = {
  readonly platform: Platform;
  /** What the SDK actually sent, preserved verbatim. Null when nothing was. */
  readonly raw: string | null;
  /** True when we could not map it — the caller warns, and we keep the raw. */
  readonly unrecognised: boolean;
};

export const readPlatform = (raw: string | null | undefined): PlatformReading => {
  if (raw === null || raw === undefined || raw.trim().length === 0) {
    return { platform: "other", raw: null, unrecognised: false };
  }
  const mapped = ALIASES[strip(raw)];
  if (mapped !== undefined) return { platform: mapped, raw, unrecognised: false };
  // Unmapped: store `other`, keep the raw so it is discoverable, and say so.
  return { platform: "other", raw, unrecognised: true };
};

export const isPlatform = (raw: string): raw is Platform =>
  (PLATFORMS as readonly string[]).includes(raw);
