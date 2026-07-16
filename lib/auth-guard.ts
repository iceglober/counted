import { NextResponse } from "next/server";
import { auth } from "./auth";
import { db } from "./db";
import { projectMembers, projects } from "./db/schema";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";

// A 401 that tells an agent where to learn the auth requirements (RFC 9728 /
// WorkOS auth.md), so it can authenticate from one request instead of hunting
// for the well-known document. Use on API read endpoints when the guard 401s.
export function unauthorized(error = "Unauthorized") {
  return NextResponse.json(
    { error },
    {
      status: 401,
      headers: {
        "WWW-Authenticate":
          'Bearer resource_metadata="https://counted.dev/.well-known/oauth-protected-resource"',
      },
    },
  );
}

export async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" as const, status: 401 as const, session: null };
  }
  return { error: null, status: null, session };
}

type Membership = { projectId: string; userId: string; role: string };

/**
 * Authorize access to a project.
 *
 * By default this is cookie/session only. Pass `{ allowServerKey: true }` on
 * read/scripting endpoints to also accept an `Authorization: Bearer sk_...`
 * server key — the "Full API access" Pro differentiator. A valid server key
 * grants owner-equivalent scope to the single project it belongs to.
 */
export async function requireProjectAccess(
  projectId: string,
  opts: { allowServerKey?: boolean } = {},
) {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });

  if (session) {
    const membership = await db.query.projectMembers.findFirst({
      where: and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, session.user.id),
      ),
    });
    if (membership) {
      return { error: null, status: null, session, membership };
    }
  }

  if (opts.allowServerKey) {
    const authz = h.get("authorization") ?? "";
    if (authz.startsWith("Bearer sk_")) {
      const key = authz.slice("Bearer ".length).trim();
      const project = await db.query.projects.findFirst({
        where: eq(projects.serverKey, key),
      });
      if (project && project.id === projectId) {
        const membership: Membership = { projectId, userId: "", role: "owner" };
        return { error: null, status: null, session, membership };
      }
    }
  }

  if (!session) {
    return { error: "Unauthorized" as const, status: 401 as const, session: null, membership: null };
  }
  return { error: "Forbidden" as const, status: 403 as const, session, membership: null };
}

/**
 * Parse a JSON request body, returning a ready-made 400 response on malformed
 * input instead of letting `request.json()` throw a 500. Canonical shape:
 * `{ error: "Invalid JSON body" }`.
 */
export async function readJson<T = unknown>(
  request: Request,
): Promise<{ ok: true; body: T } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, body: (await request.json()) as T };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
}
