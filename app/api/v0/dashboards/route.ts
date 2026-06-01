import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dashboards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireProjectAccess } from "@/lib/auth-guard";
import { createDefaultLayout } from "@/lib/default-dashboard";
import { createAgentDashboardLayout } from "@/lib/agent-dashboard";

const DASHBOARD_TEMPLATES = {
  blank: { name: "Untitled", layout: { insights: [] } },
  default: { name: "Product metrics", layout: createDefaultLayout() },
  agent: { name: "Agent Analytics", layout: createAgentDashboardLayout() },
} as const;

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const access = await requireProjectAccess(projectId);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const result = await db.query.dashboards.findMany({
    where: eq(dashboards.projectId, projectId),
  });

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { projectId, name, slug, layout, filters, isDefault, template } = body;

  if (!projectId || !slug) {
    return NextResponse.json(
      { error: "projectId and slug are required" },
      { status: 400 },
    );
  }

  const access = await requireProjectAccess(projectId);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // A template fills the layout + a default name; an explicit layout/name wins.
  const tpl = template && template in DASHBOARD_TEMPLATES
    ? DASHBOARD_TEMPLATES[template as keyof typeof DASHBOARD_TEMPLATES]
    : null;

  const [result] = await db
    .insert(dashboards)
    .values({
      projectId,
      name: name ?? tpl?.name ?? "Untitled",
      slug,
      layout: layout ?? tpl?.layout ?? { insights: [] },
      filters: filters ?? {},
      // New dashboards are never default — the project's first one stays default.
      isDefault: isDefault ?? false,
    })
    .returning();

  return NextResponse.json(result, { status: 201 });
}
