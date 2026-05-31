import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { projectMembers, projects, dashboards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateApiKey } from "@/lib/api-key";
import { createDefaultLayout } from "@/lib/default-dashboard";

export default async function DashboardRedirect() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const memberships = await db.query.projectMembers.findMany({
    where: eq(projectMembers.userId, session.user.id),
    with: { project: true },
  });

  if (memberships.length > 0) {
    redirect(`/${memberships[0].project.id}`);
  }

  // No projects — create a default one
  const result = await db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({ name: "My App", apiKey: generateApiKey() })
      .returning();

    await tx.insert(projectMembers).values({
      projectId: project.id,
      userId: session.user.id,
      role: "owner",
    });

    await tx.insert(dashboards).values({
      projectId: project.id,
      name: "Default",
      slug: "default",
      layout: createDefaultLayout(),
      isDefault: true,
    });

    return project;
  });

  redirect(`/${result.id}`);
}
