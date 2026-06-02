import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dashboards } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireSession, requireProjectAccess } from "@/lib/auth-guard";
import { createDefaultLayout } from "@/lib/default-dashboard";
import { createAgentDashboardLayout } from "@/lib/agent-dashboard";

const DASHBOARD_TEMPLATES = {
  blank: { name: "Untitled", layout: { insights: [] } },
  default: { name: "Product metrics", layout: createDefaultLayout() },
  agent: { name: "Agent Analytics", layout: createAgentDashboardLayout() },
} as const;

export async function GET(request: NextRequest) {
  const { session, error, status } = await requireSession();
  if (error) return NextResponse.json({ error }, { status });

  // Dashboards are workspace-level (owned by the user). An optional projectId
  // narrows to those associated with a project.
  const projectId = request.nextUrl.searchParams.get("projectId");
  const result = await db.query.dashboards.findMany({
    where: projectId
      ? and(eq(dashboards.userId, session!.user.id), eq(dashboards.projectId, projectId))
      : eq(dashboards.userId, session!.user.id),
  });

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const { session, error, status } = await requireSession();
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const { projectId, name, slug, layout, filters, isDefault, template } = body;

  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  // If associating a project, the user must have access to it.
  if (projectId) {
    const access = await requireProjectAccess(projectId);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
  }

  // A template fills the layout + a default name; an explicit layout/name wins.
  const tpl = template && template in DASHBOARD_TEMPLATES
    ? DASHBOARD_TEMPLATES[template as keyof typeof DASHBOARD_TEMPLATES]
    : null;

  const [result] = await db
    .insert(dashboards)
    .values({
      userId: session!.user.id,
      projectId: projectId || null,
      name: name ?? tpl?.name ?? "Untitled",
      slug,
      layout: layout ?? tpl?.layout ?? { insights: [] },
      filters: filters ?? {},
      // New dashboards are never default — the first one stays default.
      isDefault: isDefault ?? false,
    })
    .returning();

  return NextResponse.json(result, { status: 201 });
}
