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
