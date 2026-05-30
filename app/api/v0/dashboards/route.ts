import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dashboards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const result = await db.query.dashboards.findMany({
    where: eq(dashboards.projectId, projectId),
  });

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { projectId, name, slug, layout, filters, isDefault } = body;

  if (!projectId || !name || !slug) {
    return NextResponse.json(
      { error: "projectId, name, and slug are required" },
      { status: 400 },
    );
  }

  const [result] = await db
    .insert(dashboards)
    .values({
      projectId,
      name,
      slug,
      layout: layout ?? [],
      filters: filters ?? {},
      isDefault: isDefault ?? false,
    })
    .returning();

  return NextResponse.json(result, { status: 201 });
}
