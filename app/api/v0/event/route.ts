import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { events, projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { bufferEvents } from "@/lib/event-buffer";

export async function POST(request: NextRequest) {
  const appKey = request.headers.get("app-key");
  if (!appKey) {
    return NextResponse.json({ error: "Missing App-Key header" }, { status: 401 });
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.apiKey, appKey),
  });

  if (!project) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  const body = await request.json();
  const eventList = Array.isArray(body) ? body : [body];

  if (eventList.length > 50) {
    return NextResponse.json(
      { error: "Batch size exceeds 50" },
      { status: 400 },
    );
  }

  const rows = eventList.map((evt: any) => ({
    projectId: project.id,
    timestamp: new Date(evt.timestamp || Date.now()),
    sessionId: evt.sessionId,
    eventName: evt.eventName,
    osName: evt.systemProps?.osName ?? null,
    osVersion: evt.systemProps?.osVersion ?? null,
    locale: evt.systemProps?.locale ?? null,
    appVersion: evt.systemProps?.appVersion ?? null,
    deviceModel: evt.systemProps?.deviceModel ?? null,
    isDebug: evt.systemProps?.isDebug ?? false,
    sdkVersion: evt.systemProps?.sdkVersion ?? null,
    props: evt.props ?? {},
  }));

  await bufferEvents(rows);

  return new NextResponse(null, { status: 202 });
}
