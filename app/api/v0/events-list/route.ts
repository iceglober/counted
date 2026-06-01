import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireSession } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { projectMembers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const { session, error, status } = await requireSession();
  if (error) return NextResponse.json({ error }, { status });

  const projectIds = request.nextUrl.searchParams.getAll("projectId");

  // If no projectIds specified, get all the user's projects
  let ids = projectIds;
  if (ids.length === 0) {
    const memberships = await db.query.projectMembers.findMany({
      where: eq(projectMembers.userId, session!.user.id),
    });
    ids = memberships.map((m) => m.projectId);
  }

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
