import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dashboards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireProjectAccess } from "@/lib/auth-guard";
import { randomBytes } from "node:crypto";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const existing = await db.query.dashboards.findFirst({
    where: eq(dashboards.id, id),
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const access = await requireProjectAccess(existing.projectId);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const shareToken = randomBytes(16).toString("hex");

  const [result] = await db
    .update(dashboards)
    .set({ shareToken, updatedAt: new Date() })
    .where(eq(dashboards.id, id))
    .returning();

  return NextResponse.json({ shareToken: result.shareToken });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const existing = await db.query.dashboards.findFirst({
    where: eq(dashboards.id, id),
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const access = await requireProjectAccess(existing.projectId);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  await db
    .update(dashboards)
    .set({ shareToken: null, updatedAt: new Date() })
    .where(eq(dashboards.id, id));

  return NextResponse.json({ shareToken: null });
}
