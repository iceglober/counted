import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, dashboards, projectMembers, events } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireProjectAccess } from "@/lib/auth-guard";
import { pool } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const access = await requireProjectAccess(id);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (access.membership!.role !== "owner") {
    return NextResponse.json({ error: "Only owners can update projects" }, { status: 403 });
  }

  const { name } = await request.json();

  const [result] = await db
    .update(projects)
    .set({ ...(name !== undefined && { name }) })
    .where(eq(projects.id, id))
    .returning();

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(result);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const access = await requireProjectAccess(id);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (access.membership!.role !== "owner") {
    return NextResponse.json({ error: "Only owners can delete projects" }, { status: 403 });
  }

  await db.transaction(async (tx) => {
    await pool.query("DELETE FROM events WHERE project_id = $1", [id]);
    await tx.delete(dashboards).where(eq(dashboards.projectId, id));
    await tx.delete(projectMembers).where(eq(projectMembers.projectId, id));
    await tx.delete(projects).where(eq(projects.id, id));
  });

  return new NextResponse(null, { status: 204 });
}
