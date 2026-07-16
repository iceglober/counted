import type { SystemProps } from "./types";

// Injected at build time by tsup (`define`). Falls back when running from
// source (e.g. tests), where the identifier is left undeclared.
declare const __SDK_VERSION__: string | undefined;
const VERSION = typeof __SDK_VERSION__ !== "undefined" ? __SDK_VERSION__ : "0.0.0-dev";
const SDK_VERSION = `counted/${VERSION}`;

const NODE_PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

export function detectSystemProps(appVersion?: string): SystemProps {
  const props: SystemProps = {
    osName: null,
    osVersion: null,
    locale: null,
    appVersion: appVersion ?? null,
    deviceModel: null,
    sdkVersion: SDK_VERSION,
    isDebug: false,
  };

  if (typeof globalThis.navigator !== "undefined" && globalThis.navigator.userAgent) {
    const ua = globalThis.navigator.userAgent;

    if (ua.includes("Mac OS X")) {
      props.osName = "macOS";
      const match = ua.match(/Mac OS X (\d+[._]\d+[._]?\d*)/);
      if (match) props.osVersion = match[1].replace(/_/g, ".");
    } else if (ua.includes("Windows")) {
      props.osName = "Windows";
      const match = ua.match(/Windows NT (\d+\.\d+)/);
      if (match) props.osVersion = match[1];
    } else if (ua.includes("Linux")) {
      props.osName = "Linux";
    } else if (ua.includes("Android")) {
      props.osName = "Android";
      const match = ua.match(/Android (\d+[\.\d]*)/);
      if (match) props.osVersion = match[1];
    } else if (ua.includes("iPhone") || ua.includes("iPad")) {
      props.osName = "iOS";
      const match = ua.match(/OS (\d+[_\d]*)/);
      if (match) props.osVersion = match[1].replace(/_/g, ".");
    }

    props.locale = globalThis.navigator.language ?? null;
  }

  if (typeof process !== "undefined" && process.versions?.node) {
    // Map to the same display names the browser branch uses.
    props.osName = NODE_PLATFORM_NAMES[process.platform] ?? process.platform;

    // osVersion is the OS kernel release, not the Node runtime version.
    const getBuiltin = (process as { getBuiltinModule?: (m: string) => unknown }).getBuiltinModule;
    if (typeof getBuiltin === "function") {
      try {
        const os = getBuiltin("os") as { release?: () => string } | undefined;
        props.osVersion = os?.release?.() ?? null;
      } catch {
        props.osVersion = null;
      }
    } else {
      props.osVersion = null;
    }
  }

  return props;
}
