import { NextRequest, NextResponse } from "next/server";
import { pool, db } from "@/lib/db";
import { requireSession } from "@/lib/auth-guard";
import { projectMembers, projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";

export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.getAll("projectId");

  // Resolve the caller's authorized project ids up front — either from their
  // session membership or a server key (sk_) Bearer token. Any requested
  // projectIds are then intersected with these, so an authenticated caller can
  // never read the raw event stream of a project they don't belong to.
  let allowedIds: string[];

  const authz = (await headers()).get("authorization") ?? "";
  if (authz.startsWith("Bearer sk_")) {
    const key = authz.slice("Bearer ".length).trim();
    const project = await db.query.projects.findFirst({
      where: eq(projects.serverKey, key),
    });
    if (!project) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    allowedIds = [project.id];
  } else {
    const { session, error, status } = await requireSession();
    if (error) return NextResponse.json({ error }, { status });
    const memberships = await db.query.projectMembers.findMany({
      where: eq(projectMembers.userId, session!.user.id),
    });
    allowedIds = memberships.map((m) => m.projectId);
  }

  const allowed = new Set(allowedIds);
  const ids = requested.length > 0
    ? requested.filter((id) => allowed.has(id))
    : allowedIds;

  if (ids.length === 0) {
    return NextResponse.json([]);
  }

  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  const result = await pool.query(
    `SELECT event_name, session_id, os_name, locale, timestamp, props, project_id
     FROM events WHERE project_id IN (${placeholders})
     ORDER BY timestamp DESC LIMIT 100`,
    ids,
  );

  return NextResponse.json(result.rows);
}
