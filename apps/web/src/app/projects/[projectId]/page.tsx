import { requireCaller } from "@/lib/session";
import { CredentialTable } from "@/components/credentials";
import { MonitorTable } from "@/components/monitors";

export const dynamic = "force-dynamic";

type Project = { readonly id: string; readonly name: string; readonly state: string };
type Credential = {
  readonly id: string;
  readonly kind: "ingest" | "service";
  readonly label: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly revokedAt?: string | null;
};
type Monitor = {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly state: string;
  readonly lastValue?: number | null;
};

/**
 * One project: its keys and its monitors, on one page.
 *
 * **Monitors live here**, at project scope. In v1 they were a tab in Settings
 * with their own project selector, so the alert you created could belong to a
 * project other than the one you were looking at — and nothing on the alert
 * said which. A monitor watches one project's events; this is the page about
 * that project.
 */
export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const caller = await requireCaller();

  // Independently, so one failing section does not blank the other two. A
  // project whose monitors cannot be listed still shows its keys.
  const [project, credentials, monitors] = await Promise.all([
    caller.api<Project>("getProject", { params: { projectId } }),
    // `null` on failure, never an empty list: "this project has no keys" and
    // "we could not ask" are different sentences, and only one of them sends
    // somebody to issue a key they already have.
    caller.api<{ items: readonly Credential[] }>("listCredentials", { params: { projectId } }).then((r) => r.data.items, () => null),
    caller.api<{ items: readonly Monitor[] }>("listMonitors", { params: { projectId } }).then((r) => r.data.items, () => null),
  ]);

  return (
    <main>
      <h1>{project.data.name}</h1>

      <h2>Keys</h2>
      <CredentialTable credentials={credentials} />

      <h2>Monitors</h2>
      <MonitorTable monitors={monitors} />
    </main>
  );
}
