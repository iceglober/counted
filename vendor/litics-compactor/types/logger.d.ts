export type LogFields = Record<string, unknown>;
export type Logger = {
    info(message: string, fields?: LogFields): void;
    warn(message: string, fields?: LogFields): void;
    error(message: string, fields?: LogFields): void;
};
export declare const describeError: (cause: unknown) => string;
export declare const silentLogger: Logger;
/** One JSON line per event on stdout/stderr. */
export declare const consoleLogger: Logger;
