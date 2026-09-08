/**
 * What the journey runs against: a real API process, a real Postgres, and a
 * stub standing in for the one thing that cannot be real.
 *
 * Everything here exists because `bun test` proves the wrong thing about this
 * codebase. The unit suites run over in-memory fakes, and the three defects
 * this journey found were all invisible to them: a project-creation ordering
 * that only fails when the workspace's project register is derived from a real
 * `projects` table, a tenancy row nothing ever wrote, and a contract namespace
 * nobody mounted. So: no fakes, no `buildApi` shortcut. The API is started the
 * way a deployment starts it (`bun apps/api/src/main.ts`), talked to over HTTP,
 * and checked against the database with a second connection.
 *
 * **The one stub is the payment provider, and it is named rather than hidden.**
 * Counted has no Stripe test key in this environment, and a checkout route that
 * can only be exercised by taking somebody's money is a route nobody exercises.
 * `stripeStub` serves the two endpoints the gateway calls, and the API reaches
 * it through `STRIPE_API_BASE` — the same hook `stripe-mock` uses. What that
 * proves is everything up to the wire: authorization, the subscription lookup,
 * the checkout-versus-portal decision, the price lookup, the request Stripe
 * would receive, and the session that comes back. What it does not prove is
 * Stripe's own behaviour, and the report says so.
 *
 * The suite is repeatable against a fresh database and against a used one: the
 * API applies all three schemas at boot, and every identifier the journey mints
 * carries a per-run suffix, so a second run shares a database with the first
 * and collides with nothing.
 */

import { createHmac } from "node:crypto";
import { Client, StreamableHTTPClientTransport, UnauthorizedError } from "@modelcontextprotocol/client";
import { Pool } from "pg";
import { packNow } from "@counted/analytics-adapter-litics";

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

/**
 * The local compose database unless `COUNTED_JOURNEY_DATABASE_URL` says
 * otherwise. Deliberately not `DATABASE_URL`: Bun loads `.env.local` for
 * anything run from the repository root, and a hosted URL left there for
 * other work must not become the one this suite provisions accounts into.
 */
export const DATABASE_URL =
  process.env["COUNTED_JOURNEY_DATABASE_URL"] ?? "postgres://counted:counted@127.0.0.1:5434/counted";

/** Not 8080: a developer's `bun run dev` is often already there. */
const API_PORT = Number(process.env["COUNTED_JOURNEY_PORT"] ?? 8791);
const STRIPE_PORT = Number(process.env["COUNTED_JOURNEY_STRIPE_PORT"] ?? 12111);

/** Unique per run, so a second run against the same database collides with nothing. */
export const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export type Stripe = {
  readonly origin: string;
  /** Every request the API made, so the journey can assert what Stripe saw. */
  readonly seen: { path: string; body: string }[];
  stop(): Promise<void>;
};

/**
 * The provider stub.
 *
 * Speaks Stripe's wire format rather than the adapter's: form-encoded in, JSON
 * out, at the real paths. That is the point — the Stripe SDK does the encoding,
 * so what arrives here is what would arrive at Stripe, and the journey can read
 * `client_reference_id` and the metadata off it.
 */
export const stripeStub = (): Stripe => {
  const seen: { path: string; body: string }[] = [];
  const server = Bun.serve({
    port: STRIPE_PORT,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      const body = await request.text();
      seen.push({ path, body });

      if (path === "/v1/checkout/sessions") {
        return Response.json({
          id: `cs_test_${RUN}`,
          object: "checkout.session",
          url: `https://checkout.stripe.test/c/pay/cs_test_${RUN}`,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        });
      }
      if (path.startsWith("/v1/prices/")) {
        const annual = path.endsWith("annual");
        return Response.json({ active: true, currency: "usd", unit_amount: annual ? 9999 : 999,
          recurring: { interval: annual ? "year" : "month", interval_count: 1 } });
      }
      if (path.startsWith("/v1/subscriptions/")) {
        return Response.json({ cancel_at_period_end: true, items: { data: [{
          current_period_end: 1790812800,
          price: { unit_amount: 9900, currency: "usd", recurring: { interval: "year", interval_count: 1 } },
        }] } });
      }
      if (path === "/v1/billing_portal/sessions") {
        return Response.json({
          id: `bps_test_${RUN}`,
          object: "billing_portal.session",
          url: `https://billing.stripe.test/p/session/${RUN}`,
        });
      }
      return Response.json({ error: { message: `stub has no ${path}` } }, { status: 404 });
    },
  });

  return {
    origin: `http://127.0.0.1:${STRIPE_PORT}`,
    seen,
    stop: async () => {
      await server.stop(true);
    },
  };
};

export type Api = {
  readonly origin: string;
  readonly log: () => string;
  stop(): Promise<void>;
};

/**
 * Start `apps/api/src/main.ts` and wait for it to be *ready*, not merely alive.
 *
 * `/health` answers before the database is reachable; `/health/ready` is the
 * one that checks the domain tables and the analytics schema. Waiting on the
 * first is how a suite ends up asserting against a replica that has not
 * migrated yet.
 */
export const startApi = async (stripe: Stripe): Promise<Api> => {
  const origin = `http://127.0.0.1:${API_PORT}`;
  const child = Bun.spawn(["bun", `${REPO}/apps/api/src/main.ts`], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      DATABASE_URL,
      COUNTED_API_URL: origin,
      COUNTED_CONSOLE_URL: "http://127.0.0.1:3000",
      /**
       * The surrounding stack's secret, not one of our own.
       *
       * pg_cron only runs against the database named by `cron.database_name`,
       * so litics' migrations can only be applied to `counted` — the journey
       * therefore shares the development database rather than making one. And
       * `auth.jwks` holds a private key encrypted with whatever secret first
       * wrote it: a different one here makes better-auth throw "Failed to
       * decrypt private key" on the first authenticated request, as a bare 500
       * from `/v1/me`. Sharing the database means sharing the secret.
       */
      COUNTED_AUTH_SECRET:
        process.env["COUNTED_AUTH_SECRET"] ?? "dev-secret-not-for-production-0123456789abcdef",
      COUNTED_UNCLAIMED_WORKSPACE_ID: "ws_holding",
      COUNTED_UNCLAIMED_WORKSPACE_OWNER_ID: "acct_operator",
      // Deliberately fake, and pointed at the stub. A real key here would send
      // a journey run's traffic to Stripe.
      STRIPE_SECRET_KEY: "sk_test_journey",
      STRIPE_WEBHOOK_SECRET: "whsec_journey",
      STRIPE_PRICE_PRO_MONTHLY: "price_journey_monthly",
      STRIPE_PRICE_PRO_ANNUAL: "price_journey_annual",
      STRIPE_API_BASE: stripe.origin,
      LOG_LEVEL: "info",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const chunks: string[] = [];
  const drain = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) chunks.push(decoder.decode(chunk));
  };
  void drain(child.stdout);
  void drain(child.stderr);
  const log = (): string => chunks.join("");

  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`the API exited with ${child.exitCode} before becoming ready:\n${log()}`);
    }
    const ready = await fetch(`${origin}/health/ready`).catch(() => null);
    if (ready !== null && ready.status === 200) break;
    if (Date.now() > deadline) throw new Error(`the API never became ready:\n${log()}`);
    await Bun.sleep(250);
  }

  return {
    origin,
    log,
    stop: async () => {
      child.kill("SIGTERM");
      await Promise.race([child.exited, Bun.sleep(5_000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
};

/** The response of one call, with the body already read. */
export type Call = {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers;
};

export type Caller = {
  /** Session cookie, once signed in. */
  cookie: string | null;
  /** Bearer credential, when calling as a key rather than a person. */
  bearer: string | null;
};

export const anonymous = (): Caller => ({ cookie: null, bearer: null });

export const call = async (
  api: Api,
  caller: Caller,
  method: string,
  path: string,
  body?: unknown,
  extra: Readonly<Record<string, string>> = {},
): Promise<Call> => {
  const headers: Record<string, string> = { ...extra };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (caller.cookie !== null) headers["cookie"] = caller.cookie;
  if (caller.bearer !== null) headers["authorization"] = `Bearer ${caller.bearer}`;

  const response = await fetch(`${api.origin}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text.length === 0 ? null : JSON.parse(text);
  } catch {
    // Left as the raw text. A body that is not JSON is a finding, not a crash.
  }
  return { status: response.status, body: parsed, headers: response.headers };
};

/** A field of a JSON body, without `as` and without pretending it is typed. */
export const at = (body: unknown, ...path: readonly (string | number)[]): unknown => {
  let cursor: unknown = body;
  for (const key of path) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string | number, unknown>)[key];
  }
  return cursor;
};

export const str = (body: unknown, ...path: readonly (string | number)[]): string => {
  const value = at(body, ...path);
  if (typeof value !== "string") {
    throw new Error(`expected a string at ${path.join(".")}, got ${JSON.stringify(value)}`);
  }
  return value;
};

export const num = (body: unknown, ...path: readonly (string | number)[]): number => {
  const value = at(body, ...path);
  if (typeof value !== "number") {
    throw new Error(`expected a number at ${path.join(".")}, got ${JSON.stringify(value)}`);
  }
  return value;
};

/** The session cookie better-auth set, in the form it wants back. */
export const sessionCookie = (response: Call): string => {
  const raw = response.headers.get("set-cookie");
  if (raw === null) throw new Error("no set-cookie on the sign-up response");
  const first = raw.split(";")[0];
  if (first === undefined) throw new Error(`unparseable set-cookie: ${raw}`);
  return first;
};

export const database = (): Pool => new Pool({ connectionString: DATABASE_URL, max: 4 });

/**
 * Pack staging into segments now, instead of waiting for the compactor.
 *
 * A query is right before this runs — the engine unions the staging tail
 * into every read — so a test that has just written an event does not need
 * it to see the number. It exists so the suite can prove the *other* path:
 * that after a pack the same question reads the same number from a segment
 * and its summary, with staging empty. Not a shortcut around the query path;
 * the query still runs.
 */
export const flushSegments = async (pool: Pool): Promise<void> => {
  await packNow(pool);
};

/**
 * The endpoint signing secret `startApi` gives the API. Named here so the
 * journey signs deliveries with the same one, and so a test that wants a
 * forgery has something specific to sign with instead.
 */
export const STRIPE_WEBHOOK_SECRET = "whsec_journey";

/**
 * Stripe's signature scheme, implemented here rather than imported.
 *
 * `@counted/adapter-stripe` exports `signPayload`, and using it would make this
 * suite verify the adapter against itself: a signer and a verifier that shared
 * a bug would agree. Thirty characters of `node:crypto` is an independent
 * witness — `t=<unix seconds>,v1=<hex>` over `${t}.${body}`, keyed with the
 * whole `whsec_…` string including the prefix (Stripe's rule, and the one
 * place it differs from Standard Webhooks).
 */
export const signStripe = (
  body: string,
  atMillis: number = Date.now(),
  secret: string = STRIPE_WEBHOOK_SECRET,
): string => {
  const timestamp = Math.floor(atMillis / 1000);
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
};

/**
 * Deliver a webhook the way Stripe does: the raw bytes, with the signature
 * over exactly those bytes.
 *
 * Not `call`, which serialises a JSON body — re-serialising changes key order
 * and whitespace and the signature stops matching. That is the entire reason
 * this route is hand-written rather than an oRPC procedure, and a helper that
 * re-encoded would test something the product never does.
 */
export const deliverWebhook = async (
  api: Api,
  body: string,
  signature: string | null,
): Promise<Call> => {
  const response = await fetch(`${api.origin}/v1/webhooks/stripe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature === null ? {} : { "stripe-signature": signature }),
    },
    body,
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text.length === 0 ? null : JSON.parse(text);
  } catch {
    // Left as raw text. A body that is not JSON is a finding, not a crash.
  }
  return { status: response.status, body: parsed, headers: response.headers };
};

/**
 * A Stripe event envelope, serialised the way a delivery arrives.
 *
 * Written out at the call site rather than abbreviated by a builder:
 * `data.object` is where every field the translator reads lives, and the
 * fields it reads are the ones that moved in Stripe's 2025 API versions
 * (`invoice.subscription` became `invoice.parent.subscription_details.
 * subscription`; `current_period_end` left the subscription for its items).
 * A fixture that hid those paths would stop proving they are read.
 */
export const stripeEvent = (
  id: string,
  type: string,
  object: Record<string, unknown>,
): string => JSON.stringify({ id, object: "event", type, data: { object } });

// ── the MCP server, and an agent to drive it ────────────────────────────────

/** Not 3002 (`bun run dev`) and not 8788: a port of the journey's own. */
const MCP_PORT = Number(process.env["COUNTED_JOURNEY_MCP_PORT"] ?? 8792);

export type Mcp = {
  readonly origin: string;
  /** The MCP endpoint — which is also the server's OAuth resource identifier. */
  readonly endpoint: string;
  readonly log: () => string;
  stop(): Promise<void>;
};

/**
 * Start `apps/mcp/src/main.ts` the way a deployment starts it, pointed at this
 * journey's API, and wait for `/health/ready`.
 *
 * The resource identifier is this server's own endpoint and the issuer is the
 * API's auth base path, which is what production would set — the metadata document the server
 * publishes is asserted against exactly these two values, so a client that
 * followed it would end up at the right authorization server.
 */
export const startMcp = async (api: Api): Promise<Mcp> => {
  const origin = `http://127.0.0.1:${MCP_PORT}`;
  const endpoint = `${origin}/mcp`;
  const child = Bun.spawn(["bun", `${REPO}/apps/mcp/src/main.ts`], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(MCP_PORT),
      COUNTED_API_URL: api.origin,
      COUNTED_MCP_RESOURCE: endpoint,
      COUNTED_OAUTH_ISSUER: `${api.origin}/api/auth`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const chunks: string[] = [];
  const drain = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) chunks.push(decoder.decode(chunk));
  };
  void drain(child.stdout);
  void drain(child.stderr);
  const log = (): string => chunks.join("");

  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`the MCP server exited with ${child.exitCode} before becoming ready:\n${log()}`);
    }
    const ready = await fetch(`${origin}/health/ready`).catch(() => null);
    if (ready !== null && ready.status === 200) break;
    if (Date.now() > deadline) throw new Error(`the MCP server never became ready:\n${log()}`);
    await Bun.sleep(100);
  }

  return {
    origin,
    endpoint,
    log,
    stop: async () => {
      child.kill("SIGTERM");
      await Promise.race([child.exited, Bun.sleep(5_000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
};

/**
 * What one tool call came back as. `ok: false` is the server's own "this was
 * refused" result — `isError` on the tool result, with the refusal in `text`,
 * which is how an agent reads it. A protocol error (an unknown tool, a reply
 * that fails the declared output schema) is not an answer at all and is
 * thrown by the client library, as it would be for any agent.
 */
export type ToolAnswer = {
  readonly ok: boolean;
  /** The API's reply as the client parsed it. `undefined` when refused. */
  readonly body: unknown;
  /** What a model would read: the reply, or the refusal and why. */
  readonly text: string;
};

export type Agent = {
  /** What `tools/list` offered. */
  tools(): Promise<readonly { readonly name: string; readonly description: string }[]>;
  call(name: string, args?: Readonly<Record<string, unknown>>): Promise<ToolAnswer>;
  close(): Promise<void>;
};

/**
 * The reference client, over Streamable HTTP, carrying one bearer.
 *
 * Pinned to the 2026-07-28 revision because that is the only era the server
 * speaks (`legacy: "reject"` in `apps/mcp/src/handler.ts`): a client that
 * negotiated downwards would be proving a code path the server does not have.
 * `bearer: null` sends no `Authorization` header at all, which is how the
 * first request of every OAuth flow arrives.
 */
export const connectAgent = async (mcp: Mcp, bearer: string | null): Promise<Agent> => {
  const client = new Client(
    { name: "counted-journey", version: "0.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(mcp.endpoint), {
    authProvider: { token: async () => bearer ?? undefined },
  });
  await client.connect(transport);

  const textOf = (content: unknown): string =>
    (Array.isArray(content) ? content : [])
      .map((block) => (typeof at(block, "text") === "string" ? (at(block, "text") as string) : ""))
      .join("\n");

  return {
    tools: async () =>
      (await client.listTools()).tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
      })),
    call: async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: { ...args } });
      const text = textOf(result.content);
      if (result.isError === true) return { ok: false, body: undefined, text };
      const body: unknown =
        result.structuredContent !== undefined
          ? result.structuredContent
          : text === ""
            ? null
            : JSON.parse(text);
      return { ok: true, body, text };
    },
    close: () => client.close(),
  };
};

/** The client library's own word for a 401 it could not recover from. */
export const isUnauthorized = (error: unknown): boolean => error instanceof UnauthorizedError;
