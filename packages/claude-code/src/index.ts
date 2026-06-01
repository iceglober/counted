import { Analytics } from "@counted/sdk";

export type CountedHookOptions = {
  projectKey: string;
  host?: string;
  sessionId?: string;
  flushInterval?: number;
};

let analytics: Analytics | null = null;

/**
 * Initialize Counted analytics for Claude Code.
 * Call this once at the start of your hook or CLI tool.
 *
 * ```ts
 * import { init, trackToolUse } from "@counted/claude-code";
 * init({ projectKey: "ck_..." });
 * ```
 */
export function init(options: CountedHookOptions) {
  analytics = new Analytics({
    projectKey: options.projectKey,
    host: options.host,
    sessionId: options.sessionId,
    sessionTimeout: 0, // Never auto-reset — agent sessions are explicit
    flushInterval: options.flushInterval ?? 10_000,
  });
}

/**
 * Track a tool use event.
 * Privacy-safe: tracks the tool name and outcome, NOT the content.
 */
export function trackToolUse(props: {
  tool: string;
  outcome?: "success" | "error" | "denied";
  durationMs?: number;
}) {
  analytics?.track("tool_use", props);
}

/**
 * Track a file edit event.
 * Privacy-safe: tracks the file path and type, NOT the content.
 */
export function trackFileEdit(props: {
  filePath: string;
  action: "create" | "edit" | "delete";
  language?: string;
}) {
  analytics?.track("file_edit", props);
}

/**
 * Track a command execution.
 * Privacy-safe: tracks the command name, NOT arguments or output.
 */
export function trackCommand(props: {
  command: string;
  exitCode?: number;
  durationMs?: number;
}) {
  analytics?.track("command_run", props);
}

/**
 * Track a session start.
 */
export function trackSessionStart(props?: {
  model?: string;
  mode?: string;
}) {
  analytics?.track("session_start", props ?? {});
}

/**
 * Track a session end.
 */
export function trackSessionEnd(props?: {
  durationMs?: number;
  toolUseCount?: number;
  fileEditCount?: number;
}) {
  analytics?.track("session_end", props ?? {});
}

/**
 * Track any custom event.
 */
export function track(eventName: string, props?: Record<string, string | number | boolean>) {
  analytics?.track(eventName, props);
}

/**
 * Flush pending events and destroy the analytics instance.
 * Call on process exit.
 */
export function destroy() {
  analytics?.destroy();
  analytics = null;
}

/**
 * Get the underlying Analytics instance for advanced use.
 */
export function getAnalytics(): Analytics | null {
  return analytics;
}
