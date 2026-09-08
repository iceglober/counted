/**
 * The tenancy ports, with their type parameters closed.
 *
 * `@counted/tenancy-ports` declares its repositories generic in the aggregate —
 * `WorkspaceRepository<Workspace, WorkspaceEvent>` — so that a storage contract
 * does not have to import the thing it stores. This is the one file that says
 * which aggregate, and every other module in this package and every adapter
 * uses these aliases rather than re-closing the parameters and risking a
 * mismatch nobody notices until an adapter is written.
 */

import type { UnitOfWork } from "@counted/persistence-ports";
import type {
  BillingEvent,
  PlanId,
  Subscription,
  Workspace,
  WorkspaceEvent,
} from "@counted/tenancy-domain";
import type {
  BillingGateway as GenericBillingGateway,
  SubscriptionRepository as GenericSubscriptionRepository,
  WorkspaceRepository as GenericWorkspaceRepository,
  WebhookLedger,
} from "@counted/tenancy-ports";

export type WorkspaceRepository = GenericWorkspaceRepository<Workspace, WorkspaceEvent>;
export type SubscriptionRepository = GenericSubscriptionRepository<Subscription>;
export type BillingGateway = GenericBillingGateway<PlanId, BillingEvent>;

export type { WebhookLedger };

/**
 * What a tenancy transaction hands you.
 *
 * Assembled by the composition root, which is the only place that knows which
 * contexts are deployed together — a project-creation transaction needs this
 * bundle *and* `@counted/projects-ports`', and neither package may name the
 * other. The use cases below take repositories rather than this, so they can be
 * composed inside a transaction that spans both.
 */
export type TenancyRepositories = {
  readonly workspaces: WorkspaceRepository;
  readonly subscriptions: SubscriptionRepository;
};

export type TenancyUnitOfWork = UnitOfWork<TenancyRepositories>;
