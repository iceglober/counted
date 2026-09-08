import { Input } from "@counted/ui/components/input";
/**
 * What you do to a dashboard, rather than what you read on it: who can see it,
 * and what it is called.
 *
 * Both used to sit as full-width bands under the tiles, so a page opened to
 * read numbers ended in two administrative forms.
 */
import { attempt } from "../../../../../../lib/client";
import { clientForCaller } from "../../../../../../lib/session";
import { requireAccount } from "../../../../../../lib/guard";
import { failureFromQuery } from "../../../../../../lib/failure";
import { consoleOrigin } from "../../../../../../lib/env";
import { Panel, Region } from "../../../../../../components/layout";
import { Field, Fields, FormActions } from "../../../../../../components/form";
import { FailureNotice } from "../../../../../../components/notice";
import { SubmitButton } from "../../../../../../components/submit";
import { ShareControls } from "../../../../../../components/secret";
import { renameDashboard } from "../../../../../../actions/dashboards";
import { DashboardFrame, DashboardMissing } from "../frame";
export const dynamic = "force-dynamic";
const DashboardSettings = async ({
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
  const here = `/w/${workspaceId}/dashboards/${dashboardId}/settings`;
  const client = await clientForCaller();
  const [me, board] = await Promise.all([
    attempt(client.account.me({})),
    attempt(client.dashboards.get({ dashboardId })),
  ]);
  const account = requireAccount(me);
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
  return (
    <DashboardFrame
      me={account}
      workspaceId={workspaceId}
      dashboard={dashboard}
      settings
    >
      <FailureNotice failure={failureFromQuery(query)} />

      <Region title="Sharing">
        <p>
          A share link gives read-only access to this dashboard and the projects
          its insights use.
        </p>
        <ShareControls
          dashboardId={dashboard.id}
          returnTo={here}
          origin={consoleOrigin()}
          share={dashboard.share}
        />
      </Region>

      <Region>
        <Panel title="Dashboard name">
          <form action={renameDashboard}>
            <input type="hidden" name="dashboardId" value={dashboard.id} />
            <input type="hidden" name="returnTo" value={here} />
            <Fields>
              <Field label="Name" htmlFor="rename">
                <Input
                  id="rename"
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={dashboard.name}
                />
              </Field>
            </Fields>
            <FormActions>
              <SubmitButton pendingLabel="Saving…" variant="outline">
                Rename
              </SubmitButton>
            </FormActions>
          </form>
        </Panel>
      </Region>
    </DashboardFrame>
  );
};
export default DashboardSettings;
