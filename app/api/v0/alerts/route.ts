import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { alerts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireProjectAccess, requireSession, readJson } from "@/lib/auth-guard";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const access = await requireProjectAccess(projectId);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const result = await db.query.alerts.findMany({
    where: eq(alerts.projectId, projectId),
  });

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const parsed = await readJson<{
    projectId?: string; name?: string; metric?: string; eventFilter?: string;
    condition?: string; threshold?: number | string; window?: string;
    channels?: string[]; slackWebhookUrl?: string;
  }>(request);
  if (!parsed.ok) return parsed.response;
  const { projectId, name, metric, eventFilter, condition, threshold, window, channels, slackWebhookUrl } = parsed.body;

  if (!projectId || !name || !metric || !condition || threshold === undefined) {
    return NextResponse.json(
      { error: "projectId, name, metric, condition, and threshold are required" },
      { status: 400 },
    );
  }

  if (!["above", "below"].includes(condition)) {
    return NextResponse.json({ error: "condition must be 'above' or 'below'" }, { status: 400 });
  }

  const access = await requireProjectAccess(projectId);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const [result] = await db
    .insert(alerts)
    .values({
      projectId,
      createdBy: access.session!.user.id,
      name,
      metric,
      eventFilter: eventFilter || null,
      condition,
      threshold: String(threshold),
      window: window || "1h",
      channels: channels || ["email"],
      slackWebhookUrl: slackWebhookUrl || null,
    })
    .returning();

  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest) {
  const alertId = request.nextUrl.searchParams.get("id");
  if (!alertId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const auth = await requireSession();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const alert = await db.query.alerts.findFirst({
    where: eq(alerts.id, alertId),
  });

  if (!alert) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const access = await requireProjectAccess(alert.projectId);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  await db.delete(alerts).where(eq(alerts.id, alertId));

  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest) {
  const parsed = await readJson<{
    id?: string; enabled?: boolean; name?: string; threshold?: number | string;
    condition?: string; window?: string; channels?: string[]; slackWebhookUrl?: string;
  }>(request);
  if (!parsed.ok) return parsed.response;
  const { id, enabled, name, threshold, condition, window, channels, slackWebhookUrl } = parsed.body;

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const auth = await requireSession();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const alert = await db.query.alerts.findFirst({
    where: eq(alerts.id, id),
  });

  if (!alert) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const access = await requireProjectAccess(alert.projectId);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const updates: Record<string, unknown> = {};
  if (enabled !== undefined) updates.enabled = enabled;
  if (name !== undefined) updates.name = name;
  if (threshold !== undefined) updates.threshold = String(threshold);
  if (condition !== undefined) updates.condition = condition;
  if (window !== undefined) updates.window = window;
  if (channels !== undefined) updates.channels = channels;
  if (slackWebhookUrl !== undefined) updates.slackWebhookUrl = slackWebhookUrl;

  const [result] = await db
    .update(alerts)
    .set(updates)
    .where(eq(alerts.id, id))
    .returning();

  return NextResponse.json(result);
}
