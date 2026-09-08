/**
 * The authorization middleware runs exactly once per request.
 *
 * This is not a performance test. Running it twice means resolving the
 * principal twice, reading the caller's role twice, and — for a share link —
 * resolving the token twice, all of which are database round trips on the
 * critical path of every request. It also means any future middleware with a
 * side effect (a rate-limit counter, an audit line) happens twice.
 *
 * The mistake is invisible in the source: `guarded.router({ x: guarded.x.handler(…) })`
 * and `os.router({ x: guarded.x.handler(…) })` differ by three characters and
 * by a factor of two. oRPC applies a root implementer's middleware both when a
 * procedure is built from it and when a router wraps it, so the first form
 * attaches it twice. This test is the only thing standing between the two.
 */

import { describe, expect, test } from "bun:test";
import { implement } from "@orpc/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { contract } from "@counted/contract";
import { Instant } from "@counted/kernel";
import type { ApiContext } from "../context";
import { silentLogger } from "../logging";

const AT = Instant.fromEpochMillis(1_700_000_000_000);

const context = (): ApiContext => ({
  request: new Request("http://api.test/v1/workspaces/ws_1"),
  at: AT,
  traceId: "trace-1",
  logger: silentLogger,
});

/** The two arrangements, side by side, over one trivial procedure. */
const build = (assembleWithGuarded: boolean) => {
  let calls = 0;
  const os = implement(contract).$context<ApiContext>();
  const guarded = os.use(async ({ context: current, next }) => {
    calls += 1;
    return next({ context: current });
  });

  const workspaces = {
    get: guarded.workspaces.get.handler(async ({ input }) => ({
      workspace: {
        id: input.workspaceId,
        name: "W",
        plan: "free" as const,
        payment: "none" as const,
        projectCount: 0,
        limits: { eventsPerMonth: 1, projects: 1, seats: null, retentionDays: 1 },
        inGrace: false,
      },
    })),
  };

  const router = assembleWithGuarded
    ? (guarded.router({ workspaces } as never) as never)
    : (os.router({ workspaces } as never) as never);

  return { handler: new OpenAPIHandler(router), calls: () => calls };
};

const call = async (handler: OpenAPIHandler<ApiContext>) =>
  handler.handle(new Request("http://api.test/v1/workspaces/ws_1"), {
    prefix: "/",
    context: context(),
  });

describe("the guarded implementer", () => {
  test("assembling with the plain implementer runs the middleware once", async () => {
    const built = build(false);
    const result = await call(built.handler);
    expect(result.matched).toBe(true);
    expect(built.calls()).toBe(1);
  });

  /**
   * The mistake, pinned. If oRPC ever stops double-applying, this test fails
   * and the comment in `base.ts` stops being true — which is exactly when
   * somebody should read it again.
   */
  test("assembling with the guarded implementer runs it twice", async () => {
    const built = build(true);
    await call(built.handler);
    expect(built.calls()).toBe(2);
  });

  test("the middleware sees the validated input, not the raw path segment", async () => {
    let seen: unknown = null;
    const os = implement(contract).$context<ApiContext>();
    const guarded = os.use(async ({ context: current, next }, input) => {
      seen = input;
      return next({ context: current });
    });
    const router = os.router({
      workspaces: {
        get: guarded.workspaces.get.handler(async ({ input }) => ({
          workspace: {
            id: input.workspaceId,
            name: "W",
            plan: "free" as const,
            payment: "none" as const,
            projectCount: 0,
            limits: { eventsPerMonth: 1, projects: 1, seats: null, retentionDays: 1 },
            inGrace: false,
          },
        })),
      },
    } as never) as never;

    await call(new OpenAPIHandler(router));
    expect(seen).toEqual({ workspaceId: "ws_1" });
  });
});
