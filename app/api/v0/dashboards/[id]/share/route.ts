import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dashboards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth-guard";
import { randomBytes } from "node:crypto";

// Dashboards are user-owned; authorize by ownership.
async function ownedDashboard(id: string) {
  const { session, error, status } = await requireSession();
  if (error || !session) return { error: error ?? "Unauthorized", status: status ?? 401 } as const;
  const existing = await db.query.dashboards.findFirst({ where: eq(dashboards.id, id) });
  if (!existing) return { error: "Not found", status: 404 } as const;
  if (existing.userId && existing.userId !== session.user.id) {
    return { error: "Forbidden", status: 403 } as const;
  }
  return { existing } as const;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const owned = await ownedDashboard(id);
  if ("error" in owned) {
    return NextResponse.json({ error: owned.error }, { status: owned.status });
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

  const owned = await ownedDashboard(id);
  if ("error" in owned) {
    return NextResponse.json({ error: owned.error }, { status: owned.status });
  }

  await db
    .update(dashboards)
    .set({ shareToken: null, updatedAt: new Date() })
    .where(eq(dashboards.id, id));

  return NextResponse.json({ shareToken: null });
}
