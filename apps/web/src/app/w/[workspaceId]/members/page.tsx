import { Alert, AlertDescription } from "@counted/ui/components/alert";
import { InviteMember } from "../../../../components/new-record";
import { PendingInvitations } from "../../../../components/pending-invitations";
import { emailAvailable } from "../../../../lib/auth-capabilities";
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

import { SelectControl } from "../../../../components/select-control";
/**
 * Who is in this workspace, and the three writes that change it.
 *
 * Role changes and removals go through the contract, because the rules that
 * make them refusable live in the domain: you cannot demote the last owner, and
 * setting the role someone already holds is a stated conflict rather than a
 * no-op. Inviting does not, and cannot — better-auth's organization plugin owns
 * the `invitation` table and `MembershipDirectory` is read-only, permanently.
 * See `lib/invitations.ts`.
 */
import { attempt } from "../../../../lib/client";
import { clientForCaller } from "../../../../lib/session";
import { requireAccount } from "../../../../lib/guard";
import { failureFromQuery } from "../../../../lib/failure";
import { Shell } from "../../../../components/shell";
import { PageHeader, Region } from "../../../../components/layout";
import { Field } from "../../../../components/form";
import { Empty, FailureNotice } from "../../../../components/notice";
import { SubmitButton } from "../../../../components/submit";
import { changeRole, removeMember } from "../../../../actions/workspaces";
import { day } from "../../../../lib/format";
export const dynamic = "force-dynamic";
const ROLES = ["member", "admin", "owner"] as const;
const Members = async ({
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
  const here = `/w/${workspaceId}/members`;
  const client = await clientForCaller();
  const [me, members, emailEnabled] = await Promise.all([
    attempt(client.account.me({})),
    attempt(client.workspaces.members({ workspaceId })),
    emailAvailable(),
  ]);
  const account = requireAccount(me, here);
  const role = account.workspaces.find(
    (workspace) => workspace.id === workspaceId,
  )?.role;
  const canAdminister = role === "owner";
  return (
    <Shell me={account} workspaceId={workspaceId} section="members">
      <PageHeader
        title="Members"
        purpose="Workspace access and roles."
        {...(canAdminister && emailEnabled
          ? {
              actions: (
                <InviteMember workspaceId={workspaceId} returnTo={here} />
              ),
            }
          : {})}
      />

      <FailureNotice failure={failureFromQuery(query)} />
      {query.invited === undefined ? null : (
        <Alert className="my-5">
          <AlertDescription>
            Invitation sent. They’ll appear here after accepting.
          </AlertDescription>
        </Alert>
      )}

      <Region>
        {!members.ok ? (
          <FailureNotice failure={members.failure} />
        ) : members.value.items.length === 0 ? (
          <Empty>No members yet.</Empty>
        ) : (
          <Table className="table-fixed" aria-label="Members">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Member</TableHead>
                <TableHead scope="col" className="hidden w-28 sm:table-cell">
                  Role
                </TableHead>
                <TableHead scope="col" className="hidden w-36 lg:table-cell">
                  Joined
                </TableHead>
                {canAdminister && (
                  <TableHead scope="col" className="w-14">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.value.items.map((member) => (
                <TableRow key={member.account.id}>
                  <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                    <p className="font-medium">
                      {member.account.name ?? member.account.email}
                    </p>
                    {member.account.name && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {member.account.email}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground lg:hidden">
                      <Badge variant="outline" className="capitalize sm:hidden">
                        {member.role}
                      </Badge>
                      <span>Joined {day(member.since)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="outline" className="capitalize">
                      {member.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground tabular-nums lg:table-cell">
                    {day(member.since)}
                  </TableCell>
                  {canAdminister && (
                    <TableCell className="px-2 text-right">
                      <RowActions
                        label={`Member actions: ${member.account.name ?? member.account.email}`}
                        title={member.account.name ?? member.account.email}
                      >
                        <form
                          action={changeRole}
                          className="grid min-w-0 gap-4"
                        >
                          <input
                            type="hidden"
                            name="workspaceId"
                            value={workspaceId}
                          />
                          <input
                            type="hidden"
                            name="accountId"
                            value={member.account.id}
                          />
                          <input type="hidden" name="returnTo" value={here} />
                          <div className="min-w-0">
                            <Field
                              label="Role"
                              htmlFor={`role-${member.account.id}`}
                            >
                              <SelectControl
                                id={`role-${member.account.id}`}
                                name="role"
                                defaultValue={member.role}
                                items={ROLES.map((value) => ({
                                  value,
                                  label:
                                    value[0]!.toUpperCase() + value.slice(1),
                                }))}
                              />
                            </Field>
                          </div>
                          <SubmitButton
                            pendingLabel="Saving…"
                            variant="outline"
                          >
                            Save role
                          </SubmitButton>
                        </form>
                        <form action={removeMember}>
                          <input
                            type="hidden"
                            name="workspaceId"
                            value={workspaceId}
                          />
                          <input
                            type="hidden"
                            name="accountId"
                            value={member.account.id}
                          />
                          <input type="hidden" name="returnTo" value={here} />
                          <SubmitButton
                            pendingLabel="Removing…"
                            confirm={`Remove ${member.account.email} from this workspace?`}
                            variant="destructive"
                          >
                            Remove
                          </SubmitButton>
                        </form>
                      </RowActions>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Region>
      {canAdminister && <Region title="Invitations">{!emailEnabled && <p className="text-sm text-muted-foreground">Email delivery must be configured before inviting members.</p>}<PendingInvitations key={String(query.invited ?? "initial")} workspaceId={workspaceId} emailEnabled={emailEnabled} /></Region>}
    </Shell>
  );
};
export default Members;
