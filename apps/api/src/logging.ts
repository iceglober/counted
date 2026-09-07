/**
 * Structured logging: one JSON object per line, one line per request.
 *
 * Every line carries the trace id, so a customer quoting the `x-counted-trace`
 * header from a failed request identifies every log line that request produced
 * — including the ones written by a handler deep inside a use case.
 *
 * **Nothing here ever logs a secret.** The fields are named individually rather
 * than by spreading an options object, which is the difference between a log
 * schema and a leak: v1 logged `{ ...request.headers }` on error, so every
 * `authorization: Bearer sk_live_…` in production ended up in the log store,
 * searchable, forever.
 */

import type { LogLevel } from "./config";

export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds these fields to everything it writes. */
  with(fields: LogFields): Logger;
}

const RANK: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

export type LogSink = (line: string) => void;

export type LoggerOptions = {
  readonly level: LogLevel;
  readonly service: string;
  /** Defaults to stdout. A test passes an array's push and reads it back. */
  readonly sink?: LogSink;
  readonly base?: LogFields;
  /** Injected so a log line's timestamp is deterministic in a test. */
  readonly now?: () => number;
};

export const jsonLogger = (options: LoggerOptions): Logger => {
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? Date.now;
  const base = options.base ?? {};

  const write = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (RANK[level] < RANK[options.level]) return;
    sink(
      JSON.stringify({
        time: new Date(now()).toISOString(),
        level,
        service: options.service,
        message,
        ...base,
        ...fields,
      }),
    );
  };

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    with: (fields) => jsonLogger({ ...options, base: { ...base, ...fields } }),
  };
};

/** Writes nothing. For tests that are not about logging. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  with: () => silentLogger,
};

/**
 * What is safe to say about an exception in a log line.
 *
 * The message and the constructor name; never the stack in production, because
 * a stack from a database driver routinely contains the failing statement and
 * its parameters. `main.ts` turns stacks on for a local run.
 */
export const describeError = (cause: unknown, includeStack = false): LogFields => {
  if (cause instanceof Error) {
    return {
      error: cause.message,
      errorType: cause.name,
      ...(includeStack && cause.stack !== undefined ? { stack: cause.stack } : {}),
    };
  }
  return { error: String(cause), errorType: "unknown" };
};
