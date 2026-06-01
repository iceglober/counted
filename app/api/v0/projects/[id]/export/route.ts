import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth-guard";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const access = await requireProjectAccess(id);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const format = request.nextUrl.searchParams.get("format") ?? "json";
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") ?? "10000"), 100000);

  const result = await pool.query(
    `SELECT event_name, session_id, timestamp, os_name, os_version, locale, app_version, device_model, sdk_version, is_debug, props
     FROM events WHERE project_id = $1
     ORDER BY timestamp DESC LIMIT $2`,
    [id, limit],
  );

  if (format === "csv") {
    const headers = ["event_name", "session_id", "timestamp", "os_name", "os_version", "locale", "app_version", "device_model", "sdk_version", "is_debug", "props"];
    const csvRows = [headers.join(",")];

    for (const row of result.rows) {
      csvRows.push(headers.map((h) => {
        const val = row[h];
        if (val === null || val === undefined) return "";
        if (typeof val === "object") return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
        const str = String(val);
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(","));
    }

    return new NextResponse(csvRows.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="events-export.csv"`,
      },
    });
  }

  return NextResponse.json(result.rows, {
    headers: {
      "Content-Disposition": `attachment; filename="events-export.json"`,
    },
  });
}
