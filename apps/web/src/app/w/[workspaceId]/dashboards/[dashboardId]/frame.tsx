import { Button } from "@counted/ui/components/button";
import { IconSettings } from "@tabler/icons-react";
/**
 * The frame a dashboard renders inside.
 *
 * A dashboard is a thing you look at, so the page is its tiles and nothing
 * else. Sharing and renaming used to sit as full-width bands underneath, then
 * behind a tab — but a two-tab bar spends a whole band of the page saying that
 * one of the two is not the one you want. They are a gear beside the title
 * instead, which is where the settings for the thing you are looking at belong.
 */
import Link from "next/link";
import { PageHeader } from "../../../../../components/layout";
import { Shell } from "../../../../../components/shell";
import { FailureNotice } from "../../../../../components/notice";
import type { ContractOutputs } from "../../../../../lib/client";
import type { Failure } from "../../../../../lib/failure";
type Me = ContractOutputs["account"]["me"];
type Dashboard = ContractOutputs["dashboards"]["get"]["dashboard"];
export const DashboardFrame = ({
  me,
  workspaceId,
  dashboard,
  settings = false,
  actions,
  children,
}: {
  readonly me: Me;
  readonly workspaceId: string;
  readonly dashboard: Dashboard;
  /** True on the settings page itself, where the gear would lead nowhere. */
  readonly settings?: boolean;
  readonly actions?: React.ReactNode;
  readonly children: React.ReactNode;
}) => {
  const base = `/w/${workspaceId}/dashboards/${dashboard.id}`;
  return (
    <Shell me={me} workspaceId={workspaceId} section="dashboards">
      <PageHeader
        eyebrow={
          settings ? (
            <Link href={base}>{dashboard.name}</Link>
          ) : (
            <Link href={`/w/${workspaceId}/dashboards`}>Dashboards</Link>
          )
        }
        title={settings ? "Settings" : dashboard.name}
        purpose={
          settings
            ? "Name and sharing."
            : `${dashboard.tiles.length} ${dashboard.tiles.length === 1 ? "insight" : "insights"}${dashboard.share === null ? "" : " · shared by link"}`
        }
        actions={
          <>
            {actions}
            {settings ? null : (
              <Button
                render={<Link href={`${base}/settings`} />}
                nativeButton={false}
                variant="outline"
                size="icon"
                aria-label="Dashboard settings"
              >
                <IconSettings />
              </Button>
            )}
          </>
        }
      />
      {children}
    </Shell>
  );
};
export const DashboardMissing = ({
  me,
  workspaceId,
  failure,
}: {
  readonly me: Me;
  readonly workspaceId: string;
  readonly failure: Failure;
}) => (
  <Shell me={me} workspaceId={workspaceId} section="dashboards">
    <PageHeader title="Dashboard" plain />
    <FailureNotice failure={failure} />
    <p>
      <Link href={`/w/${workspaceId}/dashboards`}>Back to dashboards</Link>
    </p>
  </Shell>
);
