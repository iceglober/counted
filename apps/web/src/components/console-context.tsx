import Link from "next/link";
import { cookies } from "next/headers";
import { ApiError, serverApi } from "@/lib/api";

/**
 * Where you are, and how to be somewhere else.
 *
 * The console had no answer to "which workspace is this?" or "which project am
 * I looking at?" — an account with two of either had no way to tell them apart
 * or move between them except by editing the URL.
 *
 * **Links, not a picker.** `surface.test.ts` forbids a project selector, and
 * that rule is worth keeping: v1's Settings carried its own project `<select>`
 * beside the shell's, so the alert you created could belong to a project other
 * than the one on screen, and nothing on the alert said which. The bug was two
 * sources of truth, not the ability to switch.
 *
 * A link switches by navigating, so the URL stays the single source of truth
 * and the page you land on is the page you are reading. Nothing here holds
 * state, which is also why this is a server component: it renders what the
 * request already knows.
 */

type Me = {
  readonly workspaces: readonly { id: string; name: string; role: string }[];
};

type ProjectList = { readonly items: readonly { id: string; name: string }[] };

export const ConsoleContext = async ({
  workspaceId,
  projectId,
}: {
  readonly workspaceId?: string;
  readonly projectId?: string;
}) => {
  const api = serverApi((await cookies()).toString() || null);

  let me: Me | null = null;
  let projects: ProjectList | null = null;
  try {
    me = (await api<Me>("describeCaller")).data;
    if (workspaceId !== undefined) {
      projects = (await api<ProjectList>("listProjects", { params: { workspaceId } })).data;
    }
  } catch (error) {
    // Chrome must never be the reason a page fails. If the caller cannot be
    // described the page itself will have redirected already; if the project
    // list is unavailable, showing the workspace alone beats showing nothing.
    if (!(error instanceof ApiError)) throw error;
  }

  const workspaces = me?.workspaces ?? [];
  if (workspaces.length === 0) return null;

  const current = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0];
  const others = workspaces.filter((w) => w.id !== current?.id);
  const project = projects?.items.find((p) => p.id === projectId);
  const siblings = (projects?.items ?? []).filter((p) => p.id !== projectId);

  return (
    <div className="page">
      <p className="small muted" style={{ margin: "0 0 1rem" }}>
        <span>Workspace: </span>
        <b>{current?.name}</b>
        {others.map((w) => (
          <span key={w.id}>
            {" · "}
            <Link href={`/dashboards?workspace=${w.id}`}>{w.name}</Link>
          </span>
        ))}

        {project !== undefined && (
          <>
            {" — Project: "}
            <b>{project.name}</b>
            {siblings.map((p) => (
              <span key={p.id}>
                {" · "}
                <Link href={`/projects/${p.id}`}>{p.name}</Link>
              </span>
            ))}
          </>
        )}

        {project === undefined && siblings.length > 0 && (
          <>
            {" — Projects: "}
            {siblings.map((p, i) => (
              <span key={p.id}>
                {i > 0 && " · "}
                <Link href={`/projects/${p.id}`}>{p.name}</Link>
              </span>
            ))}
          </>
        )}
      </p>
    </div>
  );
};
