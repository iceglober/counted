import { NextRequest, NextResponse } from "next/server";
import { buildQuery } from "@/lib/query-engine";
import { pool } from "@/lib/db";
import { requireProjectAccess } from "@/lib/auth-guard";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { projectId, query, timeRange } = body;

  if (!projectId || !query) {
    return NextResponse.json(
      { error: "projectId and query are required" },
      { status: 400 },
    );
  }

  const access = await requireProjectAccess(projectId);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const start = performance.now();
    const built = buildQuery(projectId, query, timeRange);
    const result = await pool.query(built.sql, built.params);
    const executionMs = Math.round(performance.now() - start);

    return NextResponse.json({
      data: result.rows,
      meta: {
        totalEvents: result.rows.length,
        executionMs,
      },
    });
  } catch (err: unknown) {
    console.error("[query] execution failed:", err);
    return NextResponse.json({ error: "Query execution failed" }, { status: 400 });
  }
}
