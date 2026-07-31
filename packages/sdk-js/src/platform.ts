/**
 * What platform this is running on, in the vocabulary the server stores.
 *
 * The values here are the closed enum the domain defines — `macos`, not
 * `macOS`. v1's four SDKs each sent their own spelling: `macOS` from
 * JavaScript, `darwin` from Go, `Mac OS X` from a user-agent string, `macos`
 * from Rust. All four landed in the same column, so a breakdown by operating
 * system showed macOS four times with the traffic split between them.
 *
 * The server normalises anyway — it has to, because SDKs in the wild will keep
 * sending the old values for years. But the SDK sending the canonical value is
 * what stops the problem being created in the first place, and the conformance
 * suite asserts every language agrees here rather than agreeing after a server
 * round trip.
 *
 * Detection is SSR-safe throughout: every global is checked before it is
 * touched, because this file runs in a browser, in Node, in a service worker,
 * and inside Next's server render.
 */

export type Platform =
  | "macos"
  | "windows"
  | "linux"
  | "ios"
  | "ipados"
  | "android"
  | "tvos"
  | "watchos"
  | "visionos"
  | "chromeos"
  | "freebsd"
  | "other";

export type SystemProperties = {
  readonly os_name: Platform;
  readonly os_version: string | null;
  readonly locale: string | null;
  readonly app_version: string | null;
  readonly device_model: string | null;
  readonly sdk_version: string;
};

/** Node's `process.platform` values, which are not ours. */
const NODE_PLATFORMS: Readonly<Record<string, Platform>> = {
  darwin: "macos",
  win32: "windows",
  linux: "linux",
  freebsd: "freebsd",
  openbsd: "freebsd",
  android: "android",
};

/**
 * Order matters. `iPad` must be tested before `Macintosh`, because iPadOS
 * reports a desktop Safari user-agent containing both — a rule that reads as
 * arbitrary until the day iPad traffic starts appearing as macOS.
 */
const USER_AGENT_RULES: readonly { readonly match: RegExp; readonly platform: Platform }[] = [
  { match: /iPad/i, platform: "ipados" },
  { match: /iPhone|iPod/i, platform: "ios" },
  { match: /Android/i, platform: "android" },
  { match: /CrOS/i, platform: "chromeos" },
  { match: /Macintosh|Mac OS X/i, platform: "macos" },
  { match: /Windows/i, platform: "windows" },
  { match: /FreeBSD|OpenBSD|NetBSD/i, platform: "freebsd" },
  { match: /Linux|X11/i, platform: "linux" },
];

const userAgent = (): string | null => {
  const navigator = (globalThis as { navigator?: { userAgent?: string } }).navigator;
  return typeof navigator?.userAgent === "string" ? navigator.userAgent : null;
};

const nodePlatform = (): string | null => {
  const process = (globalThis as { process?: { platform?: string } }).process;
  return typeof process?.platform === "string" ? process.platform : null;
};

export const detectPlatform = (): Platform => {
  // User-agent rules first, then `process.platform` as the fallback.
  //
  // The obvious ordering — "Node first, unless there is a user-agent" — is
  // wrong, and running it under Bun is what showed it: Bun and Deno both
  // define `navigator.userAgent`, describing the *runtime* (`Bun/1.3`) rather
  // than a browser. That check never fired and every Bun process reported
  // `other`. Trying the rules and falling through is correct everywhere: a
  // browser matches a rule, a server runtime matches none and falls back to
  // the platform it is actually on.
  const ua = userAgent();
  if (ua !== null) {
    for (const rule of USER_AGENT_RULES) if (rule.match.test(ua)) return rule.platform;
  }

  const node = nodePlatform();
  return node !== null ? (NODE_PLATFORMS[node] ?? "other") : "other";
};

const osVersion = (): string | null => {
  const ua = userAgent();
  if (ua === null) return null;
  const mac = /Mac OS X (\d+[._]\d+([._]\d+)?)/.exec(ua);
  if (mac?.[1] !== undefined) return mac[1].replace(/_/g, ".");
  const windows = /Windows NT (\d+\.\d+)/.exec(ua);
  if (windows?.[1] !== undefined) return windows[1];
  const android = /Android (\d+(\.\d+)*)/.exec(ua);
  if (android?.[1] !== undefined) return android[1];
  const ios = /OS (\d+[._]\d+([._]\d+)?) like Mac OS X/.exec(ua);
  if (ios?.[1] !== undefined) return ios[1].replace(/_/g, ".");
  return null;
};

const locale = (): string | null => {
  const navigator = (globalThis as { navigator?: { language?: string } }).navigator;
  if (typeof navigator?.language === "string") return navigator.language;
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const raw = env?.["LC_ALL"] ?? env?.["LANG"];
  if (raw === undefined || raw.length === 0) return null;
  // `en_GB.UTF-8` is not a locale tag. Take the tag and drop the encoding.
  const tag = raw.split(".")[0];
  return tag === undefined || tag.length === 0 ? null : tag.replace("_", "-");
};

export const detectSystem = (options: { appVersion?: string; sdkVersion: string }): SystemProperties => ({
  os_name: detectPlatform(),
  os_version: osVersion(),
  locale: locale(),
  app_version: options.appVersion ?? null,
  device_model: null,
  sdk_version: options.sdkVersion,
});
