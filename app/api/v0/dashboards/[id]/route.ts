import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dashboards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireSession, readJson } from "@/lib/auth-guard";

// Dashboards are user-owned; authorize by ownership.
async function ownedDashboard(id: string) {
  const { session, error, status } = await requireSession();
  if (error || !session) return { error: error ?? "Unauthorized", status: status ?? 401 } as const;
  const existing = await db.query.dashboards.findFirst({ where: eq(dashboards.id, id) });
  if (!existing) return { error: "Not found", status: 404 } as const;
  if (existing.userId && existing.userId !== session.user.id) {
    return { error: "Forbidden", status: 403 } as const;
  }
  return { existing, userId: session.user.id } as const;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const owned = await ownedDashboard(id);
  if ("error" in owned) {
    return NextResponse.json({ error: owned.error }, { status: owned.status });
  }
  const { existing, userId } = owned;

  const parsed = await readJson<{
    name?: string; slug?: string; layout?: unknown; filters?: unknown; isDefault?: boolean;
  }>(request);
  if (!parsed.ok) return parsed.response;
  const { name, slug, layout, filters, isDefault } = parsed.body;

  // One default per user.
  if (isDefault) {
    await db
      .update(dashboards)
      .set({ isDefault: false })
      .where(eq(dashboards.userId, existing.userId ?? userId));
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

  const owned = await ownedDashboard(id);
  if ("error" in owned) {
    return NextResponse.json({ error: owned.error }, { status: owned.status });
  }

  if (owned.existing.isDefault) {
    return NextResponse.json({ error: "Cannot delete the default dashboard" }, { status: 400 });
  }

  await db.delete(dashboards).where(eq(dashboards.id, id));

  return new NextResponse(null, { status: 204 });
}
