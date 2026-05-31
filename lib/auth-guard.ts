import { auth } from "./auth";
import { db } from "./db";
import { projectMembers } from "./db/schema";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";

export async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" as const, status: 401 as const, session: null };
  }
  return { error: null, status: null, session };
}

export async function requireProjectAccess(projectId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" as const, status: 401 as const, session: null, membership: null };
  }

  const membership = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, session.user.id),
    ),
  });

  if (!membership) {
    return { error: "Forbidden" as const, status: 403 as const, session, membership: null };
  }

  return { error: null, status: null, session, membership };
}
