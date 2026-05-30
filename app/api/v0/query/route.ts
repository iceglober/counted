import { NextRequest, NextResponse } from "next/server";
import { buildQuery } from "@/lib/query-engine";
import { db } from "@/lib/db";
import { sql as rawSql } from "drizzle-orm";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { projectId, query, timeRange } = body;

  if (!projectId || !query) {
    return NextResponse.json(
      { error: "projectId and query are required" },
      { status: 400 },
    );
  }

  const start = performance.now();
  const built = buildQuery(projectId, query, timeRange);
  const result = await db.execute(rawSql.raw(built.sql));
  const executionMs = Math.round(performance.now() - start);

  return NextResponse.json({
    data: result.rows,
    meta: {
      totalEvents: result.rows.length,
      executionMs,
    },
  });
}
