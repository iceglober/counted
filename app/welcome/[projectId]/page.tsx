import { db, pool } from "@/lib/db";
import { projects, projectMembers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CountedLogo } from "@/components/icons";
import { WelcomeFlow } from "./welcome-flow";

// Guided first-run after claiming a provisioned project: confirm events are
// flowing, name the project, then create the first dashboard.
export default async function WelcomePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/login`);

  const member = await db.query.projectMembers.findFirst({
    where: and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, session.user.id)),
  });
  const project = member
    ? await db.query.projects.findFirst({ where: eq(projects.id, projectId) })
    : undefined;
  if (!project) redirect("/dashboards");

  const { rows } = await pool.query<{ c: number }>(
    "SELECT count(*)::int AS c FROM events WHERE project_id = $1",
    [projectId],
  );
  const eventCount = rows[0]?.c ?? 0;

  return (
    <div className="min-h-screen bg-surface-0 flex flex-col">
      <nav className="flex items-center gap-2 px-6 py-4 border-b border-border">
        <CountedLogo className="w-4 h-4 text-accent" />
        <span className="font-display text-sm tracking-wide text-text-secondary">Counted</span>
      </nav>
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-md">
          <WelcomeFlow projectId={project.id} initialName={project.name} eventCount={eventCount} />
        </div>
      </div>
    </div>
  );
}
