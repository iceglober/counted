// Ephemeral capture server for SDK conformance tests. Mirrors the real
// POST /api/v0/event contract (Project-Key header, single-or-array body, 202)
// and records every request so the orchestrator can assert wire behavior.

export type CapturedEvent = {
  timestamp?: unknown;
  sessionId?: unknown;
  eventName?: unknown;
  systemProps?: Record<string, unknown>;
  props?: Record<string, unknown>;
};

export type CapturedRequest = {
  projectKey: string | null;
  contentType: string | null;
  wasArray: boolean; // true if the SDK sent a JSON array (batch), false if a bare object
  count: number;
  events: CapturedEvent[];
};

export type CaptureServer = {
  url: string;
  requests: () => CapturedRequest[];
  events: () => CapturedEvent[];
  reset: () => void;
  stop: () => Promise<void>;
};

export async function startCaptureServer(): Promise<CaptureServer> {
  const requests: CapturedRequest[] = [];

  const server = Bun.serve({
    port: 0, // ephemeral
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "POST" && url.pathname === "/api/v0/event") {
        const text = await req.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
        }
        const wasArray = Array.isArray(parsed);
        const events = (wasArray ? parsed : [parsed]) as CapturedEvent[];
        requests.push({
          projectKey: req.headers.get("project-key"),
          contentType: req.headers.get("content-type"),
          wasArray,
          count: events.length,
          events,
        });
        return new Response(null, { status: 202 });
      }

      if (req.method === "GET" && url.pathname === "/__captured") {
        return Response.json(requests);
      }

      if (req.method === "POST" && url.pathname === "/__reset") {
        requests.length = 0;
        return new Response(null, { status: 200 });
      }

      return new Response("not found", { status: 404 });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    requests: () => requests,
    events: () => requests.flatMap((r) => r.events),
    reset: () => {
      requests.length = 0;
    },
    stop: () => server.stop(true),
  };
}
