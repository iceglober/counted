import { can } from "../../../../../../lib/permissions";
import { CreationDialog } from "../../../../../../components/creation-dialog";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@counted/ui/components/table";
import { Badge } from "@counted/ui/components/badge";
import { RowActions } from "../../../../../../components/row-actions";

/**
 * A project's keys.
 *
 * The table shows the **four** states a key can be in — active, expiring,
 * revoked, expired — because `expiring` is a real state and not a rendering
 * decision: a key inside a rotation's grace window is still working and still
 * needs replacing. A three-state rendering either hides the deadline or claims
 * the integration is already broken.
 *
 * The status arrives on the wire, derived once in `@counted/projects-domain`,
 * so nothing here recomputes expiry from timestamps.
 */
import { attempt } from "../../../../../../lib/client";
import { clientForCaller } from "../../../../../../lib/session";
import { requireAccount } from "../../../../../../lib/guard";
import { failureFromQuery } from "../../../../../../lib/failure";
import { Disclosure, Region } from "../../../../../../components/layout";
import { Empty, FailureNotice } from "../../../../../../components/notice";
import { SubmitButton } from "../../../../../../components/submit";
import { CredentialStatusPill } from "../../../../../../components/pill";
import {
  IssueKeyForm,
  RotateKeyButton,
} from "../../../../../../components/secret";
import { revokeCredential } from "../../../../../../actions/credentials";
import { instant } from "../../../../../../lib/format";
import { ProjectFrame, ProjectMissing } from "../frame";
export const dynamic = "force-dynamic";
const Keys = async ({
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
  const here = `/w/${workspaceId}/projects/${projectId}/keys`;
  const client = await clientForCaller();
  const [me, project, credentials] = await Promise.all([
    attempt(client.account.me({})),
    attempt(client.projects.get({ projectId })),
    attempt(client.credentials.list({ projectId })),
  ]);
  const account = requireAccount(me, here);
  const canWrite = can(account, workspaceId, "credentials:write");
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
      tab="keys"
      actions={
        canWrite ? <CreationDialog title="New key">
          <IssueKeyForm
            projectId={one.id}
            returnTo={here}
            canIssueService={role === "owner" || role === "admin"}
          />
        </CreationDialog> : undefined
      }
    >
      <FailureNotice failure={failureFromQuery(query)} />

      <Region
        title="Keys"
        {...(credentials.ok
          ? {
              meta: `${credentials.value.items.length} ${credentials.value.items.length === 1 ? "key" : "keys"}`,
            }
          : {})}
      >
        {!can(account, workspaceId, "credentials:read") ? <p className="text-sm text-muted-foreground">An owner or admin can view and manage project keys.</p> : !credentials.ok ? (
          <FailureNotice failure={credentials.failure} />
        ) : credentials.value.items.length === 0 ? (
          <Empty>Create an ingest key to start sending events.</Empty>
        ) : (
          <Table className="table-fixed" aria-label="Project keys">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Key</TableHead>
                <TableHead scope="col" className="hidden w-24 sm:table-cell">
                  Type
                </TableHead>
                <TableHead scope="col" className="w-24 sm:w-28">
                  Status
                </TableHead>
                <TableHead scope="col" className="hidden w-44 lg:table-cell">
                  Expires
                </TableHead>
                <TableHead scope="col" className="hidden w-44 lg:table-cell">
                  Last used
                </TableHead>
                <TableHead scope="col" className="w-12 sm:w-14">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {credentials.value.items.map((credential) => {
                const expires =
                  credential.expiresAt === null
                    ? "Never"
                    : `${instant(credential.expiresAt)} UTC`;
                const lastUsed =
                  credential.lastUsedAt === null
                    ? "Never"
                    : `${instant(credential.lastUsedAt)} UTC`;
                const inactive =
                  credential.status === "revoked" ||
                  credential.status === "expired";
                return (
                  <TableRow key={credential.id}>
                    <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                      <p className="font-medium text-foreground">
                        {credential.name}
                      </p>
                      <code className="mt-1 block text-xs text-muted-foreground">
                        {credential.hint}
                      </code>
                      <div className="mt-2 sm:hidden">
                        <Badge variant="outline">{credential.kind}</Badge>
                      </div>
                      <dl className="mt-2 space-y-1 text-xs text-muted-foreground lg:hidden">
                        <div>
                          <dt className="inline">Expires: </dt>
                          <dd className="inline">{expires}</dd>
                        </div>
                        <div>
                          <dt className="inline">Last used: </dt>
                          <dd className="inline">{lastUsed}</dd>
                        </div>
                      </dl>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline">{credential.kind}</Badge>
                    </TableCell>
                    <TableCell>
                      <CredentialStatusPill status={credential.status} />
                    </TableCell>
                    <TableCell className="hidden whitespace-normal text-xs text-muted-foreground lg:table-cell">
                      {expires}
                    </TableCell>
                    <TableCell className="hidden whitespace-normal text-xs text-muted-foreground lg:table-cell">
                      {lastUsed}
                    </TableCell>
                    <TableCell className="px-2 text-right">
                      <RowActions
                        label={`Key actions: ${credential.name}`}
                        title={credential.name}
                      >
                        <div className="flex flex-wrap gap-3">
                          <RotateKeyButton
                            projectId={one.id}
                            credentialId={credential.id}
                            returnTo={here}
                            disabled={inactive}
                          />
                          {!inactive && (
                            <form action={revokeCredential}>
                              <input
                                type="hidden"
                                name="projectId"
                                value={one.id}
                              />
                              <input
                                type="hidden"
                                name="credentialId"
                                value={credential.id}
                              />
                              <input
                                type="hidden"
                                name="returnTo"
                                value={here}
                              />
                              <SubmitButton
                                pendingLabel="Revoking…"
                                confirm={`Revoke “${credential.name}”? Anything using it stops immediately.`}
                                variant="outline"
                                size="sm"
                              >
                                Revoke
                              </SubmitButton>
                            </form>
                          )}
                        </div>
                      </RowActions>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <Disclosure summary="What rotating and revoking do">
          <p className="text-xs text-muted-foreground">
            Rotating replaces a key after a grace period. Revoking stops it
            immediately.
          </p>
        </Disclosure>
      </Region>
    </ProjectFrame>
  );
};
export default Keys;
