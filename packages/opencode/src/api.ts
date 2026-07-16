// Low-level helper API for building your own OpenCode plugin on top of
// @counted/sdk. Exported from the "@counted/opencode/api" subpath — NOT the
// package root. OpenCode's loader calls every function exported by the plugin
// module as a plugin, so the root entry must export only CountedPlugin.
import { Analytics } from "@counted/sdk";

export type CountedHookOptions = {
  projectKey: string;
  host?: string;
  sessionId?: string;
  flushInterval?: number;
};

let analytics: Analytics | null = null;

export function init(options: CountedHookOptions) {
  analytics = new Analytics({
    projectKey: options.projectKey,
    host: options.host,
    sessionId: options.sessionId,
    sessionTimeout: 0,
    flushInterval: options.flushInterval ?? 10_000,
  });
}

export function trackToolUse(props: {
  tool: string;
  outcome?: "success" | "error" | "denied";
  durationMs?: number;
}) {
  analytics?.track("tool_use", props);
}

export function trackFileEdit(props: {
  filePath: string;
  action: "create" | "edit" | "delete";
  language?: string;
}) {
  analytics?.track("file_edit", props);
}

export function trackCommand(props: {
  command: string;
  exitCode?: number;
  durationMs?: number;
}) {
  analytics?.track("command_run", props);
}

export function trackSessionStart(props?: {
  model?: string;
  mode?: string;
}) {
  analytics?.track("session_start", props ?? {});
}

export function trackSessionEnd(props?: {
  durationMs?: number;
  toolUseCount?: number;
  fileEditCount?: number;
}) {
  analytics?.track("session_end", props ?? {});
}

export function track(eventName: string, props?: Record<string, string | number | boolean>) {
  analytics?.track(eventName, props);
}

export function destroy() {
  analytics?.destroy();
  analytics = null;
}

export function getAnalytics(): Analytics | null {
  return analytics;
}
