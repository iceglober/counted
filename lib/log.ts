// Structured logging for Railway-native observability.
//
// Railway captures stdout/stderr per service and indexes it in the Logs /
// Observability views. Emitting one JSON line per event (instead of free-text)
// makes errors filterable (`level:error`), groupable by `event`, and usable as
// the basis for Railway log alerts / notifications — no third-party error
// tracker needed.

type Fields = Record<string, unknown>;

function emit(level: "error" | "warn" | "info", event: string, fields: Fields) {
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function logError(event: string, error: unknown, context: Fields = {}) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  emit("error", event, { message, stack, ...context });
}

export function logWarn(event: string, context: Fields = {}) {
  emit("warn", event, context);
}

export function logInfo(event: string, context: Fields = {}) {
  emit("info", event, context);
}
