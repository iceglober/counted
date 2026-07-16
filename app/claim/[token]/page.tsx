import { db, pool } from "@/lib/db";
import { projects, projectMembers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CountedLogo } from "@/components/icons";
import Link from "next/link";
import { ClaimLogin } from "./claim-login";

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const project = await db.query.projects.findFirst({ where: eq(projects.claimToken, token) });
  const session = await auth.api.getSession({ headers: await headers() });

  // Only offer social sign-in when the provider is actually configured (same
  // gating as /login) — otherwise the button 500s with "Provider not found".
  const socialEnabled = !!process.env.GITHUB_CLIENT_ID || !!process.env.GOOGLE_CLIENT_ID;

  // An unclaimed project carries a claimToken because it was agent-provisioned.
  // Only claim the "already flowing" phrasing when events actually exist.
  let eventCount = 0;
  if (project) {
    const { rows } = await pool.query<{ c: number }>(
      "SELECT count(*)::int AS c FROM events WHERE project_id = $1",
      [project.id],
    );
    eventCount = rows[0]?.c ?? 0;
  }

  // Logged-in user + a valid unclaimed project → adopt it, then go to the dashboard.
  let claimed = false;
  if (project && session) {
    const existing = await db.query.projectMembers.findFirst({
      where: and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, session.user.id)),
    });
    await db.transaction(async (tx) => {
      if (!existing) {
        await tx.insert(projectMembers).values({ projectId: project.id, userId: session.user.id, role: "owner" });
      }
      await tx.update(projects).set({ claimToken: null }).where(eq(projects.id, project.id));
    });
    claimed = true;
  }
  // Land on a guided setup for the live project (name it, then add a dashboard).
  if (claimed && project) redirect(`/welcome/${project.id}`);

  const valid = !!project;

  return (
    <div className="min-h-screen bg-surface-0 flex flex-col">
      <nav className="flex items-center gap-2 px-6 py-4 border-b border-border">
        <CountedLogo className="w-4 h-4 text-accent" />
        <span className="font-display text-sm tracking-wide text-text-secondary">Counted</span>
      </nav>

      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm">
          {valid ? (
            <>
              <h1 className="text-xl font-semibold">Claim your project</h1>
              <p className="text-sm text-text-secondary mt-1 mb-5">
                {eventCount > 0
                  ? `Your agent set this up and ${eventCount.toLocaleString()} event${eventCount !== 1 ? "s are" : " is"} already flowing. Sign in and the project attaches to your account.`
                  : "This project key is live. Sign in and the project attaches to your account."}
              </p>
              <ClaimLogin token={token} socialEnabled={socialEnabled} />
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold">This link isn’t valid</h1>
              <p className="text-sm text-text-secondary mt-1">
                Already claimed, or expired.{" "}
                <Link href="/dashboards" className="text-accent hover:text-accent-hover">Go to your dashboards</Link>.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
