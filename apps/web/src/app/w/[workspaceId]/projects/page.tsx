import { can } from "../../../../lib/permissions";
import { NewRecord } from "../../../../components/new-record";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@counted/ui/components/table";
import { Badge } from "@counted/ui/components/badge";

/**
 * Every project in the workspace.
 *
 * Archived projects are hidden by default and reachable through a query
 * parameter, because they still count for nothing and showing them by default
 * makes the list longer for no reason. `includeArchived` is a declared query
 * parameter on the contract route, so the toggle is a link rather than a
 * client-side filter — the server does the filtering it already knows how to do.
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
import { archiveProject, restoreProject } from "../../../../actions/projects";
export const dynamic = "force-dynamic";
const Projects = async ({
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
  const showArchived = query.archived === "1";
  const here = `/w/${workspaceId}/projects${showArchived ? "?archived=1" : ""}`;
  const client = await clientForCaller();
  const [me, projects] = await Promise.all([
    attempt(client.account.me({})),
    // `includeArchived` is `z.stringbool()` — a query parameter arrives as a
    // string, and the contract says so rather than pretending otherwise.
    attempt(
      client.projects.list({
        workspaceId,
        includeArchived: showArchived ? "true" : "false",
      }),
    ),
  ]);
  const account = requireAccount(me, here);
  const canWrite = can(account, workspaceId, "projects:write");
  return (
    <Shell me={account} workspaceId={workspaceId} section="projects">
      <PageHeader
        title="Projects"
        purpose="Event sources, keys, and retention."
        actions={
          canWrite ? <NewRecord kind="project" workspaceId={workspaceId} returnTo={here} /> : undefined
        }
      />

      <FailureNotice failure={failureFromQuery(query)} />
      {canWrite && <p className="mb-5 text-sm"><Link href="/claim" className="text-primary-ink underline underline-offset-4">Claim a project created through the API</Link></p>}

      <Region
        title={showArchived ? "All projects" : undefined}
        meta={
          projects.ok
            ? `${projects.value.items.length} ${projects.value.items.length === 1 ? "project" : "projects"}`
            : undefined
        }
      >
        {!projects.ok ? (
          <FailureNotice failure={projects.failure} />
        ) : projects.value.items.length === 0 ? (
          <Empty>{canWrite ? "Create a project to start collecting events." : "An owner or admin can create the first project."}</Empty>
        ) : (
          <Table className="table-fixed" aria-label="Projects">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Project</TableHead>
                <TableHead scope="col" className="hidden w-32 sm:table-cell">
                  Status
                </TableHead>
                <TableHead scope="col" className="w-24">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.value.items.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="whitespace-normal">
                    <Link
                      href={`/w/${workspaceId}/projects/${project.id}`}
                      className="font-medium text-foreground underline-offset-4 hover:underline [overflow-wrap:anywhere]"
                    >
                      {project.name}
                    </Link>
                    <div className="mt-2 sm:hidden">
                      <Badge variant={project.archived ? "outline" : "success"}>
                        {project.archived ? "Archived" : "Active"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant={project.archived ? "outline" : "success"}>
                      {project.archived ? "Archived" : "Active"}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-2 text-right">
                    {canWrite && <form
                      action={
                        project.archived ? restoreProject : archiveProject
                      }
                    >
                      <input
                        type="hidden"
                        name="projectId"
                        value={project.id}
                      />
                      <input type="hidden" name="returnTo" value={here} />
                      <SubmitButton
                        pendingLabel={
                          project.archived ? "Restoring…" : "Archiving…"
                        }
                        variant="outline"
                        size="sm"
                      >
                        {project.archived ? "Restore" : "Archive"}
                      </SubmitButton>
                    </form>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <p className="mt-3 text-xs">
          {showArchived ? (
            <Link href={`/w/${workspaceId}/projects`}>Hide archived</Link>
          ) : (
            <Link href={`/w/${workspaceId}/projects?archived=1`}>
              Show archived
            </Link>
          )}
        </p>
      </Region>
    </Shell>
  );
};
export default Projects;
