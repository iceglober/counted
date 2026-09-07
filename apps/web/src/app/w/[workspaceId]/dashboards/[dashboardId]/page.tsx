import Link from "next/link";
import { attempt } from "../../../../../lib/client";
import { clientForCaller } from "../../../../../lib/session";
import { requireAccount } from "../../../../../lib/guard";
import { failureFromQuery } from "../../../../../lib/failure";
import { DashboardFrame, DashboardMissing } from "./frame";
import { Empty, FailureNotice } from "../../../../../components/notice";
import { InsightBuilder } from "../../../../../components/insight-builder";
import { InsightGrid } from "../../../../../components/insight-grid";
export const dynamic = "force-dynamic";
const Board = async ({
  params,
  searchParams,
}: {
  readonly params: Promise<{
    readonly workspaceId: string;
    readonly dashboardId: string;
  }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const { workspaceId, dashboardId } = await params;
  const query = await searchParams;
  const here = `/w/${workspaceId}/dashboards/${dashboardId}`;

  const client = await clientForCaller();
  const [me, board, readouts, projects] = await Promise.all([
    attempt(client.account.me({})),
    attempt(client.dashboards.get({ dashboardId })),
    attempt(client.dashboards.readouts({ dashboardId })),
    attempt(client.projects.list({ workspaceId })),
  ]);
  const account = requireAccount(me, here);

  if (!board.ok) {
    return (
      <DashboardMissing
        me={account}
        workspaceId={workspaceId}
        failure={board.failure}
      />
    );
  }

  const dashboard = board.value.dashboard;
  const usableProjects = projects.ok
    ? projects.value.items.filter((one) => !one.archived)
    : [];

  return (
    <DashboardFrame
      me={account}
      workspaceId={workspaceId}
      dashboard={dashboard}
      actions={
        usableProjects.length > 0 ? (
          <InsightBuilder
            dashboardId={dashboardId}
            returnTo={here}
            projects={usableProjects}
          />
        ) : undefined
      }
    >
      <FailureNotice failure={failureFromQuery(query)} />
      {!projects.ok && <FailureNotice failure={projects.failure} />}
      {!readouts.ok && <FailureNotice failure={readouts.failure} />}
      {dashboard.tiles.length > 0 ? (
        <InsightGrid dashboard={dashboard} readouts={readouts.ok ? readouts.value.readouts : []} workspaceId={workspaceId} projects={projects.ok ? projects.value.items : []} />
      ) : (
        <div className="space-y-5">
          <Empty>
            {usableProjects.length > 0 ? (
              "Add your first insight to start seeing your metrics."
            ) : (
              <>
                Create a project to start receiving events, then add your first
                insight.{" "}
                <Link href={`/w/${workspaceId}/projects`}>
                  Create a project.
                </Link>
              </>
            )}
          </Empty>
          {usableProjects.length > 0 && (
            <InsightBuilder
              dashboardId={dashboardId}
              returnTo={here}
              projects={usableProjects}
              label="Add the first insight"
            />
          )}
        </div>
      )}
    </DashboardFrame>
  );
};
export default Board;
