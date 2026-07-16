// Next.js native error instrumentation. `onRequestError` fires for every
// uncaught server error (route handlers, server components, server actions,
// middleware) — exactly the silent 500s that otherwise reach a user with no
// trace. We log them as one structured line so they show up in Railway's Logs /
// Observability and can drive Railway notifications. No third-party tracker.

type ErrorRequest = { path?: string; method?: string };
type ErrorContext = {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
};

// Runs once on server startup. On a graceful shutdown (Railway sends SIGTERM on
// redeploy), the event route has already 202'd events that live only in the
// in-memory buffer, so we drain them before exit. Without this, every redeploy
// silently drops up to a full buffer (≈200 events / 5s) of acknowledged events.
//
// Remaining at-most-once window: events accepted in the milliseconds after the
// drain starts, or a hard SIGKILL before the final DB write returns, are still
// lost. This narrows the window from "every deploy" to "the drain tail".
export async function register(): Promise<void> {
  // Signal handlers only exist in the Node.js runtime, and the shutdown module
  // (which pulls in pg via the buffer, and calls process.once) must never enter
  // the Edge bundle — so it's imported dynamically behind this guard.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerShutdownHandlers } = await import("./lib/shutdown");
  registerShutdownHandlers();
}

export async function onRequestError(
  error: unknown,
  request: ErrorRequest,
  context: ErrorContext,
): Promise<void> {
  const { logError } = await import("./lib/log");
  logError("request_error", error, {
    path: request.path,
    method: request.method,
    routerKind: context.routerKind,
    routeType: context.routeType,
    routePath: context.routePath,
  });
}
