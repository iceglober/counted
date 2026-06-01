import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth-guard";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const access = await requireProjectAccess(projectId);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const result = await pool.query(
    `SELECT event_name, session_id, os_name, locale, timestamp, props
     FROM events WHERE project_id = $1
     ORDER BY timestamp DESC LIMIT 100`,
    [projectId],
  );

  return NextResponse.json(result.rows);
}
