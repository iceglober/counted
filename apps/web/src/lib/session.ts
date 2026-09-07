/**
 * The console's read of who is calling: the cookie on the inbound request, and
 * nothing more.
 *
 * `next/headers` is async in Next 16 and only callable from a server component,
 * a route handler or a server action — which is exactly the set of places that
 * are allowed to talk to the API. There is no client-side variant of this file
 * on purpose: a browser that could build its own client would need an API
 * origin baked into the bundle, and then the proxy stops being the only way
 * out.
 */

import { headers } from "next/headers";
import { contractClient, authorityFrom, type ConsoleClient } from "./client";

/** A contract client carrying the caller's authority, and no other. */
export const clientForCaller = async (): Promise<ConsoleClient> =>
  contractClient({ authority: authorityFrom(await headers()) });

/** The raw cookie, for the two calls that cannot go through the typed client. */
export const cookieForCaller = async (): Promise<string | undefined> =>
  authorityFrom(await headers()).cookie;
