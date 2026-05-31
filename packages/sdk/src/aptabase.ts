import { Analytics } from "./analytics";
import type { EventProperties } from "./types";

let instance: Analytics | null = null;

export function init(appKey: string, opts?: { appVersion?: string; host?: string }) {
  instance = new Analytics({
    appKey,
    host: opts?.host,
  });
}

export function trackEvent(eventName: string, props?: EventProperties) {
  instance?.track(eventName, props);
}
