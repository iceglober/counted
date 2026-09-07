import { NewRecord } from "../../../../components/new-record";
import { ActionLink } from "../../../../components/action-link";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@counted/ui/components/table";
import { RowActions } from "../../../../components/row-actions";
import { Badge } from "@counted/ui/components/badge";

/**
 * Every dashboard in the workspace, and the two writes that belong to a list:
 * create one, and delete one.
 *
 * `tileCount` and `shared` come off `DashboardSummary` rather than being
 * counted here — the list route already answers them, and a console that
 * fetched every dashboard to count its tiles would make an N+1 out of a
 * summary that exists to prevent one.
 */
import Link from "next/link";
import { attempt } from "../../../../lib/client";
import { clientForCaller } from "../../../../lib/session";
import { requireAccount } from "../../../../lib/guard";
import { failureFromQuery } from "../../../../lib/failure";
import { Shell } from "../../../../components/shell";
import { PageHeader, Region } from "../../../../components/layout";
import { Empty, FailureNotice } from "../../../../components/notice";
import { SubmitButton } from "../../../../components/submit";
import {
  deleteDashboard,
  setDefaultDashboard,
} from "../../../../actions/dashboards";
import { count } from "../../../../lib/format";
export const dynamic = "force-dynamic";
const Dashboards = async ({
  params,
  searchParams,
}: {
  readonly params: Promise<{
    readonly workspaceId: string;
  }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const { workspaceId } = await params;
  const query = await searchParams;
  const here = `/w/${workspaceId}/dashboards`;
  const client = await clientForCaller();
  const [me, dashboards, projects] = await Promise.all([
    attempt(client.account.me({})),
    attempt(client.dashboards.list({ workspaceId })),
    // Read only to answer one question: can a dashboard built here hold
    // anything? A tile names a project, so with none active the invitation to
    // "create one and add tiles" is an invitation to a dead end — which is
    // exactly the trap a new workspace used to walk into.
    attempt(client.projects.list({ workspaceId, includeArchived: "false" })),
  ]);
  const account = requireAccount(me, here);
  const hasProject =
    projects.ok && projects.value.items.some((one) => !one.archived);
  return (
    <Shell me={account} workspaceId={workspaceId} section="dashboards">
      <PageHeader
        title="Dashboards"
        purpose="Your metrics, at a glance."
        actions={
          <NewRecord
            kind="dashboard"
            workspaceId={workspaceId}
            returnTo={here}
          />
        }
      />

      <FailureNotice failure={failureFromQuery(query)} />
      {!projects.ok && <FailureNotice failure={projects.failure} />}

      <Region>
        {!dashboards.ok ? (
          <FailureNotice failure={dashboards.failure} />
        ) : dashboards.value.items.length === 0 ? (
          <Empty>
            {!projects.ok ? "Project availability could not be checked. Retry this page before adding insights." : hasProject ? (
              "Create your first dashboard, then add insights."
            ) : (
              <>
                Create a project to start building dashboards.{" "}
                <Link href={`/w/${workspaceId}/projects`}>
                  Create a project first.
                </Link>
              </>
            )}
          </Empty>
        ) : (
          <Table className="table-fixed" aria-label="Dashboards">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Dashboard</TableHead>
                <TableHead scope="col" className="w-20 text-right sm:w-24">
                  Insights
                </TableHead>
                <TableHead scope="col" className="hidden w-28 md:table-cell">
                  Sharing
                </TableHead>
                <TableHead scope="col" className="w-14">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboards.value.items.map((dashboard) => (
                <TableRow key={dashboard.id}>
                  <TableCell className="whitespace-normal">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                      <Link
                        href={`${here}/${dashboard.id}`}
                        className="min-w-0 font-medium text-foreground underline-offset-4 hover:underline [overflow-wrap:anywhere]"
                      >
                        {dashboard.name}
                      </Link>
                      {dashboard.isDefault && (
                        <Badge variant="secondary">Default</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground md:hidden">
                      {dashboard.shared ? "Shared by link" : "Private"}
                    </p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {count(dashboard.tileCount)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="text-muted-foreground">
                      {dashboard.shared ? "Shared by link" : "Private"}
                    </span>
                  </TableCell>
                  <TableCell className="px-2 text-right">
                    <RowActions
                      label={`Dashboard actions: ${dashboard.name}`}
                      title={dashboard.name}
                    >
                      <ActionLink
                        href={`${here}/${dashboard.id}`}
                        variant="outline"
                      >
                        Open dashboard
                      </ActionLink>
                      {!dashboard.isDefault && (
                        <form action={setDefaultDashboard}>
                          <input
                            type="hidden"
                            name="dashboardId"
                            value={dashboard.id}
                          />
                          <input type="hidden" name="returnTo" value={here} />
                          <SubmitButton
                            pendingLabel="Setting…"
                            variant="outline"
                          >
                            Make default
                          </SubmitButton>
                        </form>
                      )}
                      <form action={deleteDashboard}>
                        <input
                          type="hidden"
                          name="dashboardId"
                          value={dashboard.id}
                        />
                        <input
                          type="hidden"
                          name="workspaceId"
                          value={workspaceId}
                        />
                        <input type="hidden" name="returnTo" value={here} />
                        <SubmitButton
                          pendingLabel="Deleting…"
                          confirm={`Delete “${dashboard.name}” and its insights?`}
                          variant="destructive"
                        >
                          Delete
                        </SubmitButton>
                      </form>
                    </RowActions>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Region>
    </Shell>
  );
};
export default Dashboards;
