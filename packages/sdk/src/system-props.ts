import type { SystemProps } from "./types";

const SDK_VERSION = "counted/0.0.1";

export function detectSystemProps(): SystemProps {
  const props: SystemProps = {
    osName: null,
    osVersion: null,
    locale: null,
    appVersion: null,
    deviceModel: null,
    sdkVersion: SDK_VERSION,
    isDebug: false,
  };

  if (typeof globalThis.navigator !== "undefined") {
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
    props.osName = process.platform;
    props.osVersion = process.version;
  }

  return props;
}
