import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { projectMembers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Toaster } from "@/components/ui/sonner";
import { SignupTracker } from "@/components/signup-tracker";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  const memberships = await db.query.projectMembers.findMany({
    where: eq(projectMembers.userId, session.user.id),
    with: { project: true },
  });

  const projects = memberships.map((m) => ({
    id: m.project.id,
    name: m.project.name,
  }));

  return (
    <>
      <DashboardShell projects={projects}>{children}</DashboardShell>
      <SignupTracker />
      <Toaster />
    </>
  );
}
