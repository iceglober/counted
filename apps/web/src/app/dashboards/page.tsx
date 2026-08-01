import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError, serverApi } from "@/lib/api";
import { requireCaller, workspaceFrom } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * `items`, not `dashboards` — the contract says so, and every other list
 * endpoint agrees (`listProjects`, `listCredentials`, `listMonitors` all
 * return `items`). This said `dashboards` and crashed with `undefined is not
 * an object (evaluating 'a.dashboards.length')` the first time anybody
 * reached the page, which was today: until the redirect was fixed, /dashboards
 * bounced to the marketing homepage and this line never ran.
 *
 * `api<T>()` is an unchecked cast, so a hand-written shape that disagrees with
 * the contract is invisible to the compiler. That is the actual defect here —
 * the name was only the symptom.
 */
type DashboardList = {
  readonly items: readonly { id: string; name: string; isDefault: boolean }[];
};

/**
 * Every dashboard in the workspace.
 *
 * The workspace comes from the URL rather than from a "current workspace"
 * stored anywhere: an account can belong to several, and a remembered one is a
 * fourth piece of state that can disagree with the other three.
 */
export default async function Dashboards({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  // No workspace in the URL means "the console home", not "leave the console".
  // This used to `redirect("/")`, and `/` on app.counted.dev is the *marketing*
  // homepage — both hosts are served by this one app. So a signed-in account
  // arriving at /dashboards was bounced out to the landing page, which is also
  // where the sign-in callback sent them. `workspaceFrom` already encodes the
  // right answer, and its own comment says so: the first workspace, or /start
  // when there is none.
  let workspaceId = (await searchParams).workspace;
  if (workspaceId === undefined) {
    workspaceId = workspaceFrom(await requireCaller(), undefined).id;
  }

  const api = serverApi((await cookies()).toString() || null);

  try {
    const { data } = await api<DashboardList>("listDashboards", { params: { workspaceId } });

    if (data.items.length === 0) {
      // An honest empty state: it says what to do, and does not pretend a
      // dashboard is loading.
      return (
        <main>
          <h1>Dashboards</h1>
          <p className="tile-empty">No dashboards yet. Create one to start asking questions.</p>
        </main>
      );
    }

    return (
      <main>
        <h1>Dashboards</h1>
        <ul>
          {data.items.map((dashboard) => (
            <li key={dashboard.id}>
              <Link href={`/dashboards/${dashboard.id}`}>{dashboard.name}</Link>
              {dashboard.isDefault && <span className="tile-empty"> · default</span>}
            </li>
          ))}
        </ul>
      </main>
    );
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthenticated) redirect("/sign-in");
    throw error;
  }
}
