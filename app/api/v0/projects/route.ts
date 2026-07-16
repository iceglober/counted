import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, projectMembers, subscriptions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { generateClientKey, generateServerKey } from "@/lib/api-key";
import { requireSession, readJson } from "@/lib/auth-guard";
import { PLANS } from "@/lib/stripe";

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

  const parsed = await readJson<{ name?: string }>(request);
  if (!parsed.ok) return parsed.response;
  const { name } = parsed.body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Enforce the plan's project cap (free = 3; pro = unlimited). Count the
  // projects this user owns; a member seat on someone else's project doesn't
  // count against their own cap.
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, session!.user.id),
  });
  const plan = (sub?.plan ?? "free") as keyof typeof PLANS;
  const projectLimit = PLANS[plan]?.projects ?? PLANS.free.projects;
  if (projectLimit !== -1) {
    const owned = await db.query.projectMembers.findMany({
      where: and(
        eq(projectMembers.userId, session!.user.id),
        eq(projectMembers.role, "owner"),
      ),
    });
    if (owned.length >= projectLimit) {
      return NextResponse.json(
        {
          error: `Your ${PLANS[plan].name} plan is limited to ${projectLimit} projects. Upgrade to Pro for unlimited projects.`,
        },
        { status: 403 },
      );
    }
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
