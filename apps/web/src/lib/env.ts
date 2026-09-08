/**
 * The console API and account destinations: URLs, neither of them a secret.
 *
 * That is the point, and it is an invariant rather than a coincidence. A
 * service key here — a key the web server holds and spends "on the user's
 * behalf" — would make "every console action is reachable by a third party
 * with the right key" false, because the console would be able to do things no
 * API caller can. `no-credentials.test.ts` reads this directory and fails if a
 * credential-shaped variable appears anywhere in it.
 *
 * Read at the point of use rather than once at startup, unlike `apps/api`.
 * The reason is Next: a module-level read runs at build time, where the
 * deployment's environment is not the build's, and the value gets frozen into
 * the bundle. Neither of these variables is a secret, so the cost of reading
 * per request is a `process.env` lookup and the benefit is that a redeploy with
 * a new API origin actually takes.
 */

/** No trailing slash, ever: `${origin}/v1/...` against `http://x/` gives `//v1`. */
const origin = (raw: string): string => {
  const parsed = new URL(raw);
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
};

/**
 * Where `apps/api` answers. `8080` is what `scripts/dev.sh` binds it to; the
 * API's own `PORT` default is different, and the script wins in development
 * because it is what actually starts the process.
 */
export const apiOrigin = (env: NodeJS.ProcessEnv = process.env): string =>
  origin(env.COUNTED_API_URL ?? "http://localhost:8080");

/**
 * Where this console answers, used to build the absolute URLs a hosted
 * checkout session has to return to. Stripe will not accept a relative one.
 */
export const consoleOrigin = (env: NodeJS.ProcessEnv = process.env): string =>
  origin(env.COUNTED_CONSOLE_URL ?? "http://localhost:3000");
