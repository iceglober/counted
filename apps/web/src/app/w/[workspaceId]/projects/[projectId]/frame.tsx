/**
 * The frame every project tab renders inside.
 *
 * A project holds four things that are never read together — its keys, how long
 * its events are kept, its name, and the two ways it can end — and they used to
 * share one scroll, so reaching the fourth meant passing the other three. Each
 * is a route now, and this is what they have in common: the identity, and the
 * tabs.
 *
 * The tabs are `Link`s to real routes rather than a client-side switch, so a
 * tab is linkable, the back button works, and none of it needs script.
 */
import Link from "next/link";
import { can } from "../../../../../lib/permissions";
import { PageHeader, Tabs, type Tab } from "../../../../../components/layout";
import { Shell } from "../../../../../components/shell";
import { FailureNotice } from "../../../../../components/notice";
import type { ContractOutputs } from "../../../../../lib/client";
import type { Failure } from "../../../../../lib/failure";
type Me = ContractOutputs["account"]["me"];
type Project = ContractOutputs["projects"]["get"]["project"];
export type ProjectTab = "overview" | "keys" | "retention" | "settings";
const TABS: readonly {
  readonly key: ProjectTab;
  readonly label: string;
  readonly path: string;
}[] = [
  { key: "overview", label: "Overview", path: "" },
  { key: "keys", label: "Keys", path: "/keys" },
  { key: "retention", label: "Retention", path: "/retention" },
  { key: "settings", label: "Settings", path: "/settings" },
];
export const ProjectFrame = ({
  me,
  workspaceId,
  project,
  tab,
  actions,
  children,
}: {
  readonly me: Me;
  readonly workspaceId: string;
  readonly project: Project;
  readonly tab: ProjectTab;
  readonly actions?: React.ReactNode;
  readonly children: React.ReactNode;
}) => {
  const base = `/w/${workspaceId}/projects/${project.id}`;
  const items: readonly Tab[] = TABS.filter(entry => entry.key !== "keys" || can(me, workspaceId, "credentials:read")).map((entry) => ({
    href: `${base}${entry.path}`,
    label: entry.label,
    current: entry.key === tab,
  }));
  return (
    <Shell me={me} workspaceId={workspaceId} section="projects">
      <PageHeader
        eyebrow={
          <>
            <Link href={`/w/${workspaceId}/projects`}>Projects</Link> ·{" "}
            {project.archived ? "archived" : "active"}
          </>
        }
        title={project.name}
        purpose={
          project.effectiveRetentionDays === null
            ? "Unlimited retention"
            : `${project.effectiveRetentionDays}-day retention`
        }
        {...(actions === undefined ? {} : { actions })}
      />
      <Tabs items={items} label="Project" />
      {children}
    </Shell>
  );
};
/** The project could not be read: say so inside the console, not as a blank page. */
export const ProjectMissing = ({
  me,
  workspaceId,
  failure,
}: {
  readonly me: Me;
  readonly workspaceId: string;
  readonly failure: Failure;
}) => (
  <Shell me={me} workspaceId={workspaceId} section="projects">
    <PageHeader title="Project" plain />
    <FailureNotice failure={failure} />
    <p>
      <Link href={`/w/${workspaceId}/projects`}>Back to projects</Link>
    </p>
  </Shell>
);
