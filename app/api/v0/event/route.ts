import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { bufferEvents } from "@/lib/event-buffer";
import { checkRateLimit } from "@/lib/rate-limit";

const MAX_BATCH_SIZE = 50;
const MAX_EVENT_NAME_LENGTH = 200;
const MAX_SESSION_ID_LENGTH = 100;
const MAX_PROP_KEYS = 50;
const MAX_PROP_KEY_LENGTH = 200;
const MAX_PROP_VALUE_SIZE = 10_000;

function validateEvent(evt: Record<string, unknown>, index: number): string | null {
  if (!evt.eventName || typeof evt.eventName !== "string") {
    return `events[${index}]: eventName is required and must be a string`;
  }
  if (evt.eventName.length > MAX_EVENT_NAME_LENGTH) {
    return `events[${index}]: eventName exceeds ${MAX_EVENT_NAME_LENGTH} characters`;
  }
  if (!evt.sessionId || typeof evt.sessionId !== "string") {
    return `events[${index}]: sessionId is required and must be a string`;
  }
  if (evt.sessionId.length > MAX_SESSION_ID_LENGTH) {
    return `events[${index}]: sessionId exceeds ${MAX_SESSION_ID_LENGTH} characters`;
  }
  if (evt.props !== undefined && evt.props !== null) {
    if (typeof evt.props !== "object" || Array.isArray(evt.props)) {
      return `events[${index}]: props must be an object`;
    }
    const keys = Object.keys(evt.props as object);
    if (keys.length > MAX_PROP_KEYS) {
      return `events[${index}]: props exceeds ${MAX_PROP_KEYS} keys`;
    }
    for (const key of keys) {
      if (key.length > MAX_PROP_KEY_LENGTH) {
        return `events[${index}]: prop key exceeds ${MAX_PROP_KEY_LENGTH} characters`;
      }
      const val = (evt.props as Record<string, unknown>)[key];
      if (val !== null && typeof val !== "string" && typeof val !== "number" && typeof val !== "boolean") {
        return `events[${index}]: prop "${key}" must be string, number, boolean, or null`;
      }
      if (typeof val === "string" && val.length > MAX_PROP_VALUE_SIZE) {
        return `events[${index}]: prop "${key}" value exceeds ${MAX_PROP_VALUE_SIZE} characters`;
      }
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown";

  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return new NextResponse(
      JSON.stringify({ error: "Too many requests" }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(rateCheck.retryAfter),
        },
      },
    );
  }

  const projectKey = request.headers.get("project-key") ?? request.headers.get("app-key");
  if (!projectKey) {
    return NextResponse.json({ error: "Missing Project-Key header" }, { status: 401 });
  }

  // Reject server keys on the ingestion endpoint
  if (projectKey.startsWith("sk_")) {
    return NextResponse.json({ error: "Server keys cannot be used for event ingestion. Use a client key (ck_...)." }, { status: 403 });
  }

  // Accept client keys (ck_) or legacy api keys (A-US-)
  const project = projectKey.startsWith("ck_")
    ? await db.query.projects.findFirst({ where: eq(projects.clientKey, projectKey) })
    : await db.query.projects.findFirst({ where: eq(projects.apiKey, projectKey) });

  if (!project) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  // Anonymous (agent-provisioned, unclaimed) projects stop ingesting after 7
  // days, so abandoned/abuse keys self-disable until a user claims the project.
  if (project.claimToken && Date.now() - project.createdAt.getTime() > 7 * 24 * 60 * 60 * 1000) {
    return NextResponse.json(
      { error: "Unclaimed project expired — claim it to keep ingesting events." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const eventList = Array.isArray(body) ? body : [body];

  if (eventList.length === 0) {
    return NextResponse.json({ error: "Empty event batch" }, { status: 400 });
  }

  if (eventList.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Batch size exceeds ${MAX_BATCH_SIZE}` },
      { status: 400 },
    );
  }

  for (let i = 0; i < eventList.length; i++) {
    const validationError = validateEvent(eventList[i], i);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
  }

  const rows = eventList.map((evt: Record<string, unknown>) => ({
    projectId: project.id,
    timestamp: new Date((evt.timestamp as string) || Date.now()),
    sessionId: evt.sessionId as string,
    eventName: evt.eventName as string,
    osName: (evt.systemProps as Record<string, unknown>)?.osName as string ?? null,
    osVersion: (evt.systemProps as Record<string, unknown>)?.osVersion as string ?? null,
    locale: (evt.systemProps as Record<string, unknown>)?.locale as string ?? null,
    appVersion: (evt.systemProps as Record<string, unknown>)?.appVersion as string ?? null,
    deviceModel: (evt.systemProps as Record<string, unknown>)?.deviceModel as string ?? null,
    isDebug: ((evt.systemProps as Record<string, unknown>)?.isDebug as boolean) ?? false,
    sdkVersion: (evt.systemProps as Record<string, unknown>)?.sdkVersion as string ?? null,
    props: (evt.props as Record<string, unknown>) ?? {},
  }));

  await bufferEvents(rows);

  return new NextResponse(null, { status: 202 });
}
