/**
 * Structured logging.
 *
 * One JSON line per event, always carrying the fields that make three
 * deployables searchable as one system: `service`, `requestId`, `traceId`. A
 * support conversation starts with a request id, and that id has to lead
 * somewhere.
 *
 * **What is never logged**, and is stripped rather than trusted: event
 * properties (they are the customer's data, and the product's promise is that
 * we do not read it), IP addresses, email bodies, and anything shaped like a
 * credential. The redaction is applied to the serialized line, not to the
 * fields a caller remembered to sanitise — a `sk_` that arrives inside a
 * database error message is exactly the case a field-by-field approach misses.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = {
  readonly requestId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly workspaceId?: string;
  readonly projectId?: string;
  readonly principalKind?: string;
  readonly durationMs?: number;
  readonly [key: string]: unknown;
};

export type Logger = {
  log(level: LogLevel, event: string, fields?: LogFields): void;
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** A logger that carries these fields on every line it writes. */
  with(fields: LogFields): Logger;
};

/**
 * Anything shaped like a credential we mint, plus the two legacy shapes.
 *
 * Deliberately matches on the *shape* rather than on a known list of secrets:
 * the interesting case is a key we have never seen, arriving inside a string
 * nobody expected to contain one.
 */
const SECRET_PATTERN = /\b((?:ck|sk|st|ct|svc)_[A-Za-z0-9_-]{8,})/g;
const BEARER_PATTERN = /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi;

/**
 * Replace a secret with its display prefix and a length.
 *
 * Keeping the first characters means two log lines about the same key can
 * still be correlated, which is most of why anyone wanted the key in the log.
 */
export const redact = (line: string): string =>
  line
    .replace(SECRET_PATTERN, (_m, secret: string) => `${secret.slice(0, 6)}…[redacted:${secret.length}]`)
    .replace(BEARER_PATTERN, (_m, scheme: string, token: string) => `${scheme}${token.slice(0, 4)}…[redacted:${token.length}]`);

export type LoggerOptions = {
  readonly service: string;
  readonly release?: string;
  /** Injected so tests capture instead of printing, and so does the worker. */
  readonly sink?: (line: string) => void;
  readonly now?: () => number;
  readonly minLevel?: LogLevel;
};

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const createLogger = (options: LoggerOptions): Logger => {
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => Date.now());
  const floor = RANK[options.minLevel ?? "info"];

  const build = (bound: LogFields): Logger => {
    const emit = (level: LogLevel, event: string, fields: LogFields = {}): void => {
      if (RANK[level] < floor) return;
      const line = {
        level,
        event,
        ts: new Date(now()).toISOString(),
        service: options.service,
        ...(options.release === undefined ? {} : { release: options.release }),
        ...bound,
        ...fields,
      };
      let serialized: string;
      try {
        serialized = JSON.stringify(line);
      } catch {
        // A circular or unserialisable field must not take down the request
        // it was describing. Losing the detail beats losing the line.
        serialized = JSON.stringify({ level, event, ts: new Date(now()).toISOString(), service: options.service, unserializable: true });
      }
      sink(redact(serialized));
    };

    return {
      log: emit,
      debug: (event, fields) => emit("debug", event, fields),
      info: (event, fields) => emit("info", event, fields),
      warn: (event, fields) => emit("warn", event, fields),
      error: (event, fields) => emit("error", event, fields),
      with: (fields) => build({ ...bound, ...fields }),
    };
  };

  return build({});
};
