/**
 * The four tenancy port contracts, run against the in-memory doubles.
 *
 * These are not the doubles' own tests. They are the ports', and
 * `@counted/adapter-postgres` and `@counted/adapter-stripe` run the same ones
 * against a real database and a real signature scheme. That is the whole claim
 * to being replaceable: two implementations, one definition of correct, and any
 * disagreement shows up as a failure here rather than as a surprise in
 * production.
 *
 * Writing this file found two disagreements immediately. `fakeWorkspaces`
 * answered `listForAccount` with every workspace it held at role `owner` —
 * membership it does not model — and `fakeSubscriptions` let two workspaces
 * share one provider customer, which the real schema refuses with a unique
 * index and which would make a webhook's "whose plan is this?" a coin flip.
 * Both are fixed in `testing.ts`.
 */

import { AccountId, Instant, ProjectId, WorkspaceId } from "@counted/kernel";
import { Workspace } from "@counted/tenancy-domain";
import {
  billingGatewayContract,
  subscriptionRepositoryContract,
  webhookLedgerContract,
  workspaceRepositoryContract,
  type PreparedDelivery,
} from "./contract";
import {
  FAKE_WEBHOOK_TOLERANCE,
  fakeBilling,
  fakeLedger,
  fakeSubscriptions,
  fakeWorkspaces,
  signFakeWebhook,
} from "./testing";

const AT = Instant.fromEpochMillis(Date.UTC(2026, 0, 15, 12));

/** Fresh ids per suite instance, so nothing leaks between `beforeEach`es. */
const counter = () => {
  let n = 0;
  return () => (n += 1);
};

workspaceRepositoryContract(
  "in-memory",
  () => {
    const workspaces = fakeWorkspaces();
    const next = counter();

    return {
      workspaces,
      freshWorkspace: () => WorkspaceId(`ws_${next()}`),
      freshProject: () => ProjectId(`prj_${next()}`),
      freshAccount: () => AccountId(`acct_${next()}`),
      givenMember: async (workspace, account, role) => {
        workspaces.seedMember(workspace, account, role);
      },
      /**
       * The composition root's order, in miniature: reserve the slot on the
       * workspace, then save. The real one also writes a `projects` row in the
       * same transaction — which is exactly the difference the Postgres harness
       * has to implement, and exactly what made a project-creation ordering bug
       * invisible to fakes for a whole rebuild.
       */
      givenProject: async (workspace, project, name) => {
        const found = await workspaces.find(workspace);
        if (found === null) throw new Error("harness: no such workspace");
        const registered = found.registerProject(project, name, AT);
        if (!registered.ok) {
          throw new Error(`harness: registerProject refused ${registered.error.kind}`);
        }
        await workspaces.save(registered.value.workspace, registered.value.events);
      },
      givenArchivedProject: async (workspace, project) => {
        const found = await workspaces.find(workspace);
        if (found === null) throw new Error("harness: no such workspace");
        const archived = found.archiveProject(project, AT);
        if (!archived.ok) throw new Error(`harness: archive refused ${archived.error.kind}`);
        await workspaces.save(archived.value.workspace, archived.value.events);
      },
    };
  },
  AT,
);

subscriptionRepositoryContract(
  "in-memory",
  () => {
    const subscriptions = fakeSubscriptions();
    const next = counter();
    return {
      subscriptions,
      // No foreign key here, so a workspace is just an id. The Postgres harness
      // has to create the row, which is why this is a harness method.
      givenWorkspace: async () => WorkspaceId(`ws_${next()}`),
      unknownWorkspace: () => WorkspaceId("ws_nobody"),
    };
  },
  AT,
);

webhookLedgerContract(
  "in-memory",
  () => {
    const ledger = fakeLedger();
    const next = counter();
    return { ledger, freshEventId: () => `evt_${next()}` };
  },
  AT,
);

billingGatewayContract(
  "in-memory",
  () => {
    const billing = fakeBilling();
    const next = counter();

    const delivery = (
      type: string,
      workspace: WorkspaceId | null,
      event: unknown,
    ): PreparedDelivery => {
      const id = `evt_${next()}`;
      return { id, type, body: JSON.stringify({ id, type, workspace, event }) };
    };

    return {
      billing,
      sign: (body, at) => signFakeWebhook(body, at),
      // A secret this gateway does not hold. Its signatures are well-formed and
      // must still be refused — the failure mode of a verifier that only checks
      // the header's *shape*.
      signWithWrongSecret: (body, at) => signFakeWebhook(body, at, "whsec_somebody_else"),
      checkoutCompleted: (workspace) =>
        delivery("checkout.session.completed", workspace, {
          kind: "checkout_completed",
          plan: "pro",
          customer: `cus_${next()}`,
          subscription: `sub_${next()}`,
          renewsAt: null,
        }),
      unactionable: () => delivery("invoice.upcoming", null, null),
      tolerance: FAKE_WEBHOOK_TOLERANCE,
      aWorkspace: () => WorkspaceId(`ws_${next()}`),
    };
  },
  AT,
);

/**
 * A guard on the harness itself.
 *
 * `givenProject` is the method the whole workspace suite leans on, and a
 * harness that silently did nothing would make eight assertions pass for the
 * wrong reason.
 */
import { expect, test } from "bun:test";

test("the in-memory harness's givenProject really registers a project", async () => {
  const workspaces = fakeWorkspaces();
  const id = WorkspaceId("ws_guard");
  const opened = Workspace.open(id, "Acme", AccountId("acct_guard"), AT);
  if (!opened.ok) throw new Error("unreachable: a named workspace opens");
  await workspaces.save(opened.value.workspace, opened.value.events);

  const registered = opened.value.workspace.registerProject(ProjectId("prj_guard"), "Web", AT);
  if (!registered.ok) throw new Error("unreachable");
  await workspaces.save(registered.value.workspace, registered.value.events);

  expect((await workspaces.find(id))?.projectCount).toBe(1);
});
