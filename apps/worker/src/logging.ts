/**
 * One JSON object per line on stdout, and nothing else.
 *
 * Structured rather than prose because every consumer of these lines is a
 * machine: Railway's log search, an alert on `job.failed`, a count of
 * `monitor.unobservable`. A sentence with the numbers interpolated into it is
 * unqueryable, and the numbers are the whole point — "evaluated 0 monitors" is
 * a fact somebody needs to be able to alert on.
 */

import type { LogFields, Logger } from "./ports";

type Level = "info" | "warn" | "error";

const line = (level: Level, event: string, fields: LogFields | undefined): string =>
  JSON.stringify({ level, event, ...fields });

export const consoleLogger = (write: (text: string) => void = console.log): Logger => ({
  info: (event, fields) => write(line("info", event, fields)),
  warn: (event, fields) => write(line("warn", event, fields)),
  error: (event, fields) => write(line("error", event, fields)),
});

/** Keeps what it was told, for tests that assert on what the worker reported. */
export const recordingLogger = (): Logger & {
  readonly lines: readonly { level: Level; event: string; fields: LogFields }[];
} => {
  const lines: { level: Level; event: string; fields: LogFields }[] = [];
  const at = (level: Level) => (event: string, fields?: LogFields) => {
    lines.push({ level, event, fields: fields ?? {} });
  };
  return { lines, info: at("info"), warn: at("warn"), error: at("error") };
};

/** Says nothing. For a test that is not asserting on logs. */
export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * An error's message, for a log field.
 *
 * `String(cause)` on a plain object gives `[object Object]`, which is the least
 * useful thing a failed job could say about why it failed.
 */
export const describeError = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  try {
    return JSON.stringify(cause) ?? String(cause);
  } catch {
    return String(cause);
  }
};
