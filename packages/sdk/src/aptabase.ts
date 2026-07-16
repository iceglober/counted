import { Analytics } from "./analytics";
import type { EventProperties } from "./types";

let instance: Analytics | null = null;

/**
 * Aptabase-compatible init. `appKey` maps to Counted's `projectKey`.
 * Optional `appVersion` is reported in system props.
 */
export function init(appKey: string, opts?: { appVersion?: string; host?: string }) {
  instance = new Analytics({
    projectKey: appKey,
    host: opts?.host,
    appVersion: opts?.appVersion,
  });
}

export function trackEvent(eventName: string, props?: EventProperties) {
  instance?.track(eventName, props);
}
