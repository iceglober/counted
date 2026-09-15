import type { ContractOutputs } from "../lib/client";
import { attempt } from "../lib/client";
import { clientForCaller } from "../lib/session";
import { can } from "../lib/permissions";
import { instant } from "../lib/format";
import { permissionLabel } from "../lib/credential-labels";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@counted/ui/components/table";
import { Region } from "./layout";
import { Empty, FailureNotice } from "./notice";
import { CreationDialog } from "./creation-dialog";
import { WorkspaceKeyForm, RotateWorkspaceKeyForm } from "./workspace-key-form";
import { CredentialStatusPill } from "./pill";
import { RowActions } from "./row-actions";
import { SubmitButton } from "./submit";
import { revokeWorkspaceCredential } from "../actions/credentials";

export async function WorkspaceKeys({
  account,
  workspaceId,
  returnTo,
}: {
  account: ContractOutputs["account"]["me"];
  workspaceId: string;
  returnTo: string;
}) {
  if (!can(account, workspaceId, "credentials:read"))
    return (
      <Region title="Workspace keys">
        <p className="text-sm text-muted-foreground">
          An owner or admin can view and manage workspace service keys.
        </p>
      </Region>
    );
  const client = await clientForCaller();
  const result = await attempt(
    client.credentials.listForWorkspace({ workspaceId })
  );
  if (!result.ok)
    return (
      <Region title="Workspace keys">
        <FailureNotice failure={result.failure} />
      </Region>
    );
  const keys = result.value.items.filter(
    (key) => key.project === null && key.kind === "service"
  );
  const canWrite = can(account, workspaceId, "credentials:write");
  const date = (value: string | null) =>
    value === null ? "Never" : `${instant(value)} UTC`;
  return (
    <Region
      title="Workspace keys"
      meta={`${keys.length} ${keys.length === 1 ? "key" : "keys"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-lg text-sm text-muted-foreground">
          Service keys for agents and server integrations across all projects.
          Project-specific keys live under each project’s Keys tab.
        </p>
        {canWrite && (
          <CreationDialog
            title="New workspace service key"
            trigger="New service key"
          >
            <WorkspaceKeyForm
              workspaceId={workspaceId}
              returnTo={returnTo}
              allowed={result.value.grantablePermissions}
            />
          </CreationDialog>
        )}
      </div>
      {keys.length === 0 ? (
        <Empty>No workspace service keys yet.</Empty>
      ) : (
        <Table className="table-fixed" aria-label="Workspace keys">
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="hidden w-40 lg:table-cell">
                Expires
              </TableHead>
              <TableHead className="w-12">
                <span className="sr-only">Details and actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => {
              const inactive =
                key.status === "revoked" || key.status === "expired";
              return (
                <TableRow key={key.id}>
                  <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                    <p className="font-medium">{key.name}</p>
                    <code className="mt-1 block text-xs text-muted-foreground">
                      {key.hint}
                    </code>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {key.permissions.length} {key.permissions.length === 1 ? "permission" : "permissions"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground lg:hidden">
                      Expires: {date(key.expiresAt)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <CredentialStatusPill status={key.status} />
                  </TableCell>
                  <TableCell className="hidden whitespace-normal text-xs text-muted-foreground lg:table-cell">
                    {date(key.expiresAt)}
                  </TableCell>
                  <TableCell className="px-1">
                    <RowActions
                      label={`Key details: ${key.name}`}
                      title={key.name}
                    >
                      <p className="text-xs text-muted-foreground">
                        Last used: {date(key.lastUsedAt)}
                      </p>
                      <ul
                        aria-label="Granted permissions"
                        className="grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2"
                      >
                        {key.permissions.map((permission) => (
                          <li key={permission}>
                            {permissionLabel(permission)}
                          </li>
                        ))}
                      </ul>
                      {canWrite && (
                        <div className="flex flex-wrap gap-3">
                          {key.permissions.every((permission) =>
                            result.value.grantablePermissions.includes(
                              permission
                            )
                          ) && (
                            <CreationDialog
                              disabled={inactive}
                              title="Rotate workspace key"
                              trigger="Rotate"
                            >
                              <RotateWorkspaceKeyForm
                                workspaceId={workspaceId}
                                credentialId={key.id}
                                returnTo={returnTo}
                              />
                            </CreationDialog>
                          )}
                          {!inactive && (
                            <form action={revokeWorkspaceCredential}>
                              <input
                                type="hidden"
                                name="workspaceId"
                                value={workspaceId}
                              />
                              <input
                                type="hidden"
                                name="credentialId"
                                value={key.id}
                              />
                              <input
                                type="hidden"
                                name="returnTo"
                                value={returnTo}
                              />
                              <SubmitButton
                                variant="outline"
                                pendingLabel="Revoking…"
                                confirm={`Revoke “${key.name}”? Integrations using this key will lose access immediately.`}
                              >
                                Revoke
                              </SubmitButton>
                            </form>
                          )}
                        </div>
                      )}
                    </RowActions>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Region>
  );
}
