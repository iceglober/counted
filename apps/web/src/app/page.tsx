import Link from "next/link";
import { requireCaller } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The shell.
 *
 * Rendered from `/v1/me` — the same endpoint any integrator can call — so
 * there is no state here the API cannot report. An account with no workspace
 * is a real state, not an error, and it says so.
 */
export default async function Home() {
  const caller = await requireCaller();
  const workspace = caller.workspaces[0];

  return (
    <main>
      <h1>Counted</h1>
      <p className="tile-empty">Signed in as {caller.principal}</p>

      {workspace === undefined ? (
        <p className="tile-empty">
          This account belongs to no workspace yet. Claim a project to create one.
        </p>
      ) : (
        <nav>
          <ul>
            <li>
              <Link href={`/dashboards?workspace=${workspace.id}`}>Dashboards</Link>
            </li>
            <li>
              <Link href={`/projects?workspace=${workspace.id}`}>Projects</Link>
            </li>
            <li>
              <Link href={`/settings?workspace=${workspace.id}`}>Settings</Link>
            </li>
          </ul>
          {caller.workspaces.length > 1 && (
            <p className="tile-empty">
              {/* Not a picker. Navigating is how a workspace is chosen, and a
                  remembered selection is the state #67 exists to remove. */}
              Also in:{" "}
              {caller.workspaces.slice(1).map((other) => (
                <Link key={other.id} href={`/projects?workspace=${other.id}`}>
                  {other.name}{" "}
                </Link>
              ))}
            </p>
          )}
        </nav>
      )}
    </main>
  );
}
