import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth-guard";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const access = await requireProjectAccess(id);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const [eventNames, propKeys, osNames, locales, appVersions] = await Promise.all([
    pool.query(
      `SELECT event_name, COUNT(*) as count FROM events WHERE project_id = $1 GROUP BY event_name ORDER BY count DESC LIMIT 100`,
      [id],
    ),
    pool.query(
      `SELECT DISTINCT jsonb_object_keys(props) as key FROM events WHERE project_id = $1 AND props != '{}' LIMIT 100`,
      [id],
    ),
    pool.query(
      `SELECT DISTINCT os_name FROM events WHERE project_id = $1 AND os_name IS NOT NULL ORDER BY os_name`,
      [id],
    ),
    pool.query(
      `SELECT DISTINCT locale FROM events WHERE project_id = $1 AND locale IS NOT NULL ORDER BY locale`,
      [id],
    ),
    pool.query(
      `SELECT DISTINCT app_version FROM events WHERE project_id = $1 AND app_version IS NOT NULL ORDER BY app_version DESC`,
      [id],
    ),
  ]);

  return NextResponse.json({
    eventNames: eventNames.rows.map((r) => ({ name: r.event_name, count: Number(r.count) })),
    propKeys: propKeys.rows.map((r) => r.key as string),
    systemFields: {
      osNames: osNames.rows.map((r) => r.os_name as string),
      locales: locales.rows.map((r) => r.locale as string),
      appVersions: appVersions.rows.map((r) => r.app_version as string),
    },
  });
}
