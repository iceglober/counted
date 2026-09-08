/**
 * Open a workspace and the subscription record that goes with it.
 *
 * Two writes, and they must be one. If the subscription row is missing, the
 * first Stripe webhook has nothing to update — which is the v1 failure exactly:
 * `UPDATE subscriptions … WHERE user_id` matched nothing for every first-time
 * subscriber, reported success, and the customer paid for nothing. Provisioning
 * writes the free-plan row up front so there is always something to upsert
 * onto.
 *
 * There is a third write outside this function: better-auth's `organization`
 * row, which shares the workspace's id. The composition root creates it in the
 * *same* transaction — see the note on transactions in `index.ts`. That
 * organization insert is also why this function does not first check whether
 * the workspace exists: the unique index on the organization id is what makes a
 * second provision of the same id impossible, and a check here would be a
 * second, weaker guard against something already prevented.
 */

import { isErr, ok, type AccountId, type Instant, type Result, type WorkspaceId } from "@counted/kernel";
import { Subscription, Workspace, type WorkspaceError } from "@counted/tenancy-domain";
import type { SubscriptionRepository, WorkspaceRepository } from "./ports";

export type ProvisionWorkspaceDeps = {
  readonly workspaces: WorkspaceRepository;
  readonly subscriptions: SubscriptionRepository;
};

export type ProvisionWorkspaceCommand = {
  /** Minted by the caller — better-auth's organization id, so the two agree. */
  readonly workspace: WorkspaceId;
  readonly name: string;
  readonly founder: AccountId;
};

export type ProvisionedWorkspace = {
  readonly workspace: Workspace;
  readonly subscription: Subscription;
};

export const provisionWorkspace = async (
  deps: ProvisionWorkspaceDeps,
  command: ProvisionWorkspaceCommand,
  at: Instant,
): Promise<Result<ProvisionedWorkspace, WorkspaceError>> => {
  const opened = Workspace.open(command.workspace, command.name, command.founder, at);
  if (isErr(opened)) return opened;

  const subscription = Subscription.none(command.workspace, at);

  await deps.workspaces.save(opened.value.workspace, opened.value.events);
  await deps.subscriptions.save(subscription);

  return ok({ workspace: opened.value.workspace, subscription });
};
