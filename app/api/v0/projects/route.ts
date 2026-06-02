import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, projectMembers, dashboards } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { generateApiKey, generateClientKey, generateServerKey } from "@/lib/api-key";
import { requireSession } from "@/lib/auth-guard";
import { createDefaultLayout } from "@/lib/default-dashboard";

export async function GET() {
  const { session, error, status } = await requireSession();
  if (error) {
    return NextResponse.json({ error }, { status });
  }

  const memberships = await db.query.projectMembers.findMany({
    where: eq(projectMembers.userId, session!.user.id),
    with: { project: true },
  });

  return NextResponse.json(memberships.map((m) => m.project));
}

export async function POST(request: NextRequest) {
  const { session, error, status } = await requireSession();
  if (error) {
    return NextResponse.json({ error }, { status });
  }

  const body = await request.json();
  const { name } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        name,
        apiKey: generateClientKey(),
        clientKey: generateClientKey(),
        serverKey: generateServerKey(),
      })
      .returning();

    await tx.insert(projectMembers).values({
      projectId: project.id,
      userId: session!.user.id,
      role: "owner",
    });

    // A project gets a starter dashboard, owned by the user. It's the user's
    // default only if they don't already have one (default is per-user now).
    const hasDefault = await tx.query.dashboards.findFirst({
      where: and(eq(dashboards.userId, session!.user.id), eq(dashboards.isDefault, true)),
    });
    await tx.insert(dashboards).values({
      userId: session!.user.id,
      projectId: project.id,
      name: "Default",
      slug: "default",
      layout: createDefaultLayout(),
      isDefault: !hasDefault,
    });

    return project;
  });

  return NextResponse.json(result, { status: 201 });
}
