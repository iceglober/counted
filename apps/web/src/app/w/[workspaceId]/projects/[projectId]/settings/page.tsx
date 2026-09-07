import { can } from "../../../../../../lib/permissions";
import { Input } from "@counted/ui/components/input";
/**
 * A project's name, and the two ways it can end.
 *
 * Deletion lives here rather than at the bottom of the page you read keys on.
 * Archiving is offered beside it because it is almost always what was meant:
 * it keeps the events and stops the project counting against the plan.
 */
import { attempt } from "../../../../../../lib/client";
import { clientForCaller } from "../../../../../../lib/session";
import { requireAccount } from "../../../../../../lib/guard";
import { failureFromQuery } from "../../../../../../lib/failure";
import { Panel, Region } from "../../../../../../components/layout";
import { Field, Fields, FormActions } from "../../../../../../components/form";
import { FailureNotice } from "../../../../../../components/notice";
import { SubmitButton } from "../../../../../../components/submit";
import {
  archiveProject,
  deleteProject,
  renameProject,
  restoreProject,
} from "../../../../../../actions/projects";
import { ProjectFrame, ProjectMissing } from "../frame";
export const dynamic = "force-dynamic";
const Settings = async ({
  params,
  searchParams,
}: {
  readonly params: Promise<{
    readonly workspaceId: string;
    readonly projectId: string;
  }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const { workspaceId, projectId } = await params;
  const query = await searchParams;
  const here = `/w/${workspaceId}/projects/${projectId}/settings`;
  const client = await clientForCaller();
  const [me, project] = await Promise.all([
    attempt(client.account.me({})),
    attempt(client.projects.get({ projectId })),
  ]);
  const account = requireAccount(me, here);
  const canWrite = can(account, workspaceId, "projects:write");
  const role = account.workspaces.find(
    (workspace) => workspace.id === workspaceId,
  )?.role;
  if (!project.ok) {
    return (
      <ProjectMissing
        me={account}
        workspaceId={workspaceId}
        failure={project.failure}
      />
    );
  }
  const one = project.value.project;
  return (
    <ProjectFrame
      me={account}
      workspaceId={workspaceId}
      project={one}
      tab="settings"
    >
      <FailureNotice failure={failureFromQuery(query)} />

      <Region>
        <Panel title="Project name">
          {canWrite ? <form action={renameProject}>
            <input type="hidden" name="projectId" value={one.id} />
            <input type="hidden" name="returnTo" value={here} />
            <Fields>
              <Field label="Name" htmlFor="rename">
                <Input
                  id="rename"
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={one.name}
                />
              </Field>
            </Fields>
            <FormActions>
              <SubmitButton pendingLabel="Saving…" variant="outline">
                Rename
              </SubmitButton>
            </FormActions>
          </form> : <p>{one.name} · An owner or admin can rename this project.</p>}
        </Panel>
      </Region>

      <Region title={one.archived ? "Restore or delete" : "Archive or delete"}>
        <p>
          Archiving preserves events and frees a project slot. Deleting
          permanently removes the project and its events.
        </p>

        <div className="mt-6 flex min-w-0 flex-wrap items-end gap-3">
          {canWrite && <form action={one.archived ? restoreProject : archiveProject}>
            <input type="hidden" name="projectId" value={one.id} />
            <input type="hidden" name="returnTo" value={here} />
            <SubmitButton
              pendingLabel={one.archived ? "Restoring…" : "Archiving…"}
              variant="outline"
            >
              {one.archived ? "Restore project" : "Archive project"}
            </SubmitButton>
          </form>}

          {role === "owner" ? (
            <form action={deleteProject}>
              <input type="hidden" name="projectId" value={one.id} />
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input
                type="hidden"
                name="returnTo"
                value={`/w/${workspaceId}/projects`}
              />
              <SubmitButton
                pendingLabel="Deleting…"
                variant="destructive"
                confirm={`Delete “${one.name}” and every event it holds? This cannot be undone.`}
              >
                Delete project
              </SubmitButton>
            </form>
          ) : (
            // A hint, not enforcement: the authorization decision runs once, in
            // apps/api. Rendering the button for a reader whose role cannot use
            // it would offer an action that always fails.
            <p className="text-muted-foreground">
              Only an owner can delete a project.
            </p>
          )}
        </div>
      </Region>
    </ProjectFrame>
  );
};
export default Settings;
