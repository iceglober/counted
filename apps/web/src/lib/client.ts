/**
 * The contract client, and the only way this app talks to the API.
 *
 * Every response type in the console comes from here. `RouterContractClient`
 * projects `@counted/contract` into a typed client, so a shape the API returns
 * and a shape a page renders cannot disagree — if they do, it is a compile
 * error in the page. v2 hand-wrote about twenty response types beside a regex
 * test that tried to stop the twenty-first; `no-hand-written-shapes.test.ts`
 * is the same guard with the types themselves removed, which is the fix the
 * regex was standing in for.
 *
 * **The client takes the caller's authority as an argument.** There is no
 * ambient credential, no module-level key, no "system" client. A page that
 * wants to call the API has to have been given something to call it with, and
 * the only thing there is to give is the cookie that arrived on the request.
 */

import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi/fetch";
import type { RouterContractClient } from "@orpc/contract";
import { contract, type ContractInputs, type ContractOutputs } from "@counted/contract";
import { apiOrigin } from "./env";
import { failureOf, type Failure } from "./failure";

export type ConsoleClient = RouterContractClient<typeof contract>;

/** Re-exported so pages name one import for their prop types. */
export type { ContractInputs, ContractOutputs };

/**
 * What the caller proved about themselves, and nothing else.
 *
 * A record rather than a bare cookie string so that adding, say, a trace id is
 * an addition to this type — visible, reviewable — instead of a second
 * parameter someone passes a constant to.
 */
export type Authority = {
  /** Verbatim from the inbound request. `undefined` means an anonymous call. */
  readonly cookie?: string | undefined;
};

/** Reads the caller's authority off a request. It reads nothing else. */
export const authorityFrom = (headers: Headers): Authority => {
  const cookie = headers.get("cookie");
  return cookie === null ? {} : { cookie };
};

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type ClientOptions = {
  readonly authority: Authority;
  /** Overridden only by tests. Production reads it from the environment. */
  readonly origin?: string;
  readonly fetch?: FetchLike;
};

/**
 * The origin and the mount path are two options, not one.
 *
 * `OpenAPILinkCodecOptions.url` is typed `StandardUrl`, which is a template
 * type that must start with `/` — it is the handler's mount path, and the API
 * mounts the contract at the root. The origin belongs to the fetch transport.
 * Concatenating them into `url` happens to work at runtime and does not
 * typecheck, which is the compiler being right: they are different things and a
 * `URL` instance in either slot throws inside `parseStandardUrl`.
 */
export const contractClient = (options: ClientOptions): ConsoleClient => {
  const link = new OpenAPILink(contract, {
    origin: options.origin ?? apiOrigin(),
    url: "/",
    headers: () => {
      const headers: Record<string, string> = {};
      if (options.authority.cookie !== undefined) headers.cookie = options.authority.cookie;
      return headers;
    },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  return createORPCClient(link);
};

export type Attempt<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: Failure };

/**
 * Runs one call and reports its outcome instead of throwing.
 *
 * `T` is inferred from the client, so `attempt(client.workspaces.usage({…}))`
 * is `Attempt<{ usage: Usage }>` with `Usage` coming out of the contract. No
 * annotation is written at any call site, which is what keeps the "zero
 * hand-written response shapes" rule cheap enough to actually hold.
 *
 * `@orpc/client` exports `safe`, which does something similar. It is not used
 * because its typed-error branch keys off the server's `inferable` flag: the
 * discrimination it offers is only as good as a field this app does not
 * control, and a page written against it would silently lose its error
 * handling if the API stopped setting it.
 */
export const attempt = async <T>(work: Promise<T>): Promise<Attempt<T>> => {
  try {
    return { ok: true, value: await work };
  } catch (error) {
    return { ok: false, failure: failureOf(error) };
  }
};
