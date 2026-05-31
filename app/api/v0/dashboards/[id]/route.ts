import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dashboards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireProjectAccess } from "@/lib/auth-guard";

export async function PUT(
  request: NextRequest,
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

  const { name, slug, layout, filters, isDefault } = await request.json();

  if (isDefault) {
    await db
      .update(dashboards)
      .set({ isDefault: false })
      .where(eq(dashboards.projectId, existing.projectId));
  }

  const [result] = await db
    .update(dashboards)
    .set({
      ...(name !== undefined && { name }),
      ...(slug !== undefined && { slug }),
      ...(layout !== undefined && { layout }),
      ...(filters !== undefined && { filters }),
      ...(isDefault !== undefined && { isDefault }),
      updatedAt: new Date(),
    })
    .where(eq(dashboards.id, id))
    .returning();

  return NextResponse.json(result);
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

  if (existing.isDefault) {
    return NextResponse.json({ error: "Cannot delete the default dashboard" }, { status: 400 });
  }

  const access = await requireProjectAccess(existing.projectId);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  await db.delete(dashboards).where(eq(dashboards.id, id));

  return new NextResponse(null, { status: 204 });
}
