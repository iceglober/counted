import { NextRequest, NextResponse } from "next/server";
import { buildQuery } from "@/lib/query-engine";
import { executeFunnelQuery } from "@/lib/funnel-query";
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
    // Funnels aren't expressible as a single buildQuery SQL — they run a
    // per-step sequence query. Return the funnel shape ({ steps }) directly so
    // the configurator preview can render it like the live dashboard does.
    if (Array.isArray(query.funnelSteps) && query.funnelSteps.length >= 2) {
      const start = performance.now();
      const funnel = await executeFunnelQuery(projectId, query.funnelSteps, timeRange);
      const executionMs = Math.round(performance.now() - start);
      return NextResponse.json({
        data: funnel,
        meta: { totalEvents: funnel.steps[0]?.value ?? 0, executionMs },
      });
    }

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
