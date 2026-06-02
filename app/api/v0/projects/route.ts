import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, projectMembers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateClientKey, generateServerKey } from "@/lib/api-key";
import { requireSession } from "@/lib/auth-guard";

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

    // No dashboard is created here. Dashboards are user-owned and decoupled from
    // projects — the only creators are the registration bootstrap, the "+"
    // button, and the Management API (POST /api/v0/dashboards).
    return project;
  });

  return NextResponse.json(result, { status: 201 });
}
