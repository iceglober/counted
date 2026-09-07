import { expect, test } from "bun:test";
import { Hono } from "hono";
import type { ApiEnv } from "./server";
import { listen } from "./listen";

test("a slow API response survives Bun's default 10-second idle cutoff", async () => {
  const api = new Hono<ApiEnv>();
  api.get("/slow", async (context) => {
    await Bun.sleep(11_000);
    return context.json({ completed: true });
  });
  const server = listen(api, 0);
  try {
    const response = await fetch(new URL("/slow", server.url), {
      signal: AbortSignal.timeout(20_000),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ completed: true });
  } finally {
    await server.stop(true);
  }
}, 25_000);
