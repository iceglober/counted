import Link from "next/link";
import { requireCaller, workspaceFrom } from "@/lib/session";
import { ConsoleContext } from "@/components/console-context";

export const dynamic = "force-dynamic";

type ProjectList = { readonly items: readonly { id: string; name: string; state: string }[] };

/**
 * The projects in a workspace.
 *
 * The workspace comes from the shell's context — the `?workspace=` in the URL,
 * checked against what this caller may see — and there is deliberately no
 * selector on this page. A second listbox is what #67 is about: v1 had one in
 * Settings competing with the shell's, so the alert you created could belong
 * to a different project than the one on screen.
 */
export default async function Projects({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const caller = await requireCaller();
  const workspace = workspaceFrom(caller, (await searchParams).workspace);
  const { data } = await caller.api<ProjectList>("listProjects", { params: { workspaceId: workspace.id } });

  return (
    <main>
      <ConsoleContext workspaceId={workspace.id} />
      <h1>Projects</h1>
      <p className="tile-empty">{workspace.name}</p>

      {data.items.length === 0 ? (
        <p className="tile-empty">No projects yet. Create one to start sending events.</p>
      ) : (
        <ul>
          {data.items.map((project) => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}`}>{project.name}</Link>
              {project.state === "unclaimed" && <span className="tile-empty"> · unclaimed</span>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
