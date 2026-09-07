/**
 * The implementer, and the one middleware every procedure runs behind.
 *
 * Two facts about `@orpc/*@2.0.0-beta.32`, both found by running it rather than
 * by reading about it:
 *
 * **A middleware attached to the root implementer runs TWICE if the router is
 * also assembled from that implementer.** `base.router({ x: base.x.handler(…) })`
 * applies it once when the procedure is built and once when the router wraps
 * it — so the authorization decision, and every membership lookup behind it,
 * happens twice per request. Assembling with the *plain* implementer and
 * building procedures from the guarded one runs it once. `base.test.ts` counts
 * the calls, because nothing about the code says which of the two you have.
 *
 * **A middleware sees the validated input.** `requirementFor(path)` names an
 * input field (`workspaceId`, `dashboardId`) and the value has already been
 * through the contract's Zod schema by the time this reads it — so the
 * authorization decision is made against a parsed id, not a raw path segment.
 */

import { implement } from "@orpc/server";
import { contract, requirementFor } from "@counted/contract";
import type { ApiContext, AuthorizedContext } from "../context";
import { asORPCError } from "../faults";
import { authorize, type AuthorizeDeps } from "../auth/authorize";
import { Principal } from "@counted/authorization";

export type Base = ReturnType<typeof createBase>;

export const createBase = (deps: AuthorizeDeps) => {
  const os = implement(contract).$context<ApiContext>();

  const guarded = os.use(async ({ context, path, next }, input) => {
    const requirement = requirementFor(path);
    if (requirement === undefined) {
      // A procedure in the contract tree with no declared requirement. The
      // contract's own test makes this unreachable; answering 500 rather than
      // defaulting to "deny" or "allow" is the only honest response to a route
      // whose access rule nobody wrote.
      throw asORPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "This route declares no authorization requirement.",
        data: { reason: "UndeclaredRequirement", operation: path.join(".") },
      });
    }

    const decision = await authorize(
      deps,
      requirement,
      context.request.headers,
      input,
      context.at,
    );

    if (!decision.ok) {
      context.logger.info("request refused", {
        operation: path.join("."),
        status: decision.fault.code,
        reason: String(decision.fault.data.reason),
        principal: Principal.describe(decision.principal),
        // The machine-readable gap: "your key is for another workspace" and
        // "your key is narrower than this resource" are the same 403 to the
        // caller and completely different operational problems.
        ...(decision.denial !== null && decision.denial.reason === "OutOfBinding"
          ? { gap: decision.denial.gap }
          : {}),
      });
      throw asORPCError(decision.fault);
    }

    const authorized: AuthorizedContext = { ...context, authority: decision.authority };
    return next({ context: authorized });
  });

  return { os, guarded };
};
