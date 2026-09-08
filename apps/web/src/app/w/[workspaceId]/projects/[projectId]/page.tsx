/**
 * A project at a glance, and how to send it something.
 *
 * The tab a link to a project lands on. It answers the two questions a person
 * arrives with — is this thing receiving anything, and what do I point at it —
 * and hands off to the other three tabs for the things you change.
 */
import { ProjectSetup } from "../../../../../components/project-setup";
import { can } from "../../../../../lib/permissions";
import { attempt } from "../../../../../lib/client";
import { clientForCaller } from "../../../../../lib/session";
import { requireAccount } from "../../../../../lib/guard";
import { failureFromQuery } from "../../../../../lib/failure";
import { apiOrigin } from "../../../../../lib/env";
import { KeyValues, Region } from "../../../../../components/layout";
import { FailureNotice } from "../../../../../components/notice";
import { instant } from "../../../../../lib/format";
import { ProjectFrame, ProjectMissing } from "./frame";
export const dynamic = "force-dynamic";
const Project = async ({
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
  const client = await clientForCaller();
  const [me, project] = await Promise.all([
    attempt(client.account.me({})),
    attempt(client.projects.get({ projectId })),
  ]);
  const account = requireAccount(me, `/w/${workspaceId}/projects/${projectId}`);
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
      tab="overview"
    >
      <FailureNotice failure={failureFromQuery(query)} />

      <ProjectSetup projectId={projectId} workspaceId={workspaceId} endpoint={apiOrigin()} canWrite={can(account, workspaceId, "credentials:write")} archived={one.archived} />

      <Region title="Details">
        <KeyValues
          rows={[
            { label: "Identifier", value: <code>{one.id}</code> },

            {
              label: "Retention policy",
              value:
                one.retention.kind === "inherit"
                  ? "Inherited from the plan"
                  : `${one.retention.days} days`,
            },
            {
              label: "Events kept",
              value:
                one.effectiveRetentionDays === null
                  ? "indefinitely"
                  : `${one.effectiveRetentionDays} days`,
            },
            {
              label: "Claimed",
              value:
                one.claimedAt === null
                  ? "not claimed"
                  : `${instant(one.claimedAt)} UTC`,
            },
          ]}
        />
      </Region>


    </ProjectFrame>
  );
};
export default Project;
