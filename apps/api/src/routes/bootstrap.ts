/**
 * The one way in.
 *
 * v1 had several. A project could appear from the signup flow, from
 * `/api/v0/provision`, or from the projects screen, and each built it slightly
 * differently — which is why the onboarding panel could be suppressed by
 * pre-seeded insights that one path created and the others did not.
 *
 * There is now exactly one path, and it runs in the same order whether a human
 * or an agent starts it:
 *
 *   POST /v1/provision       → an unclaimed project, its ingest key, a claim link
 *   GET  /v1/claims/{token}  → what that link would adopt, before adopting it
 *   POST /v1/claims/{token}/redeem → adopt it into a workspace, signed in
 *
 * The order matters. **The key works immediately**, before anyone signs in —
 * an unclaimed project ingests from the moment it exists, so the install
 * snippet on the first screen is a snippet somebody can actually run. Signing
 * in is how you *keep* it, not how you start.
 *
 * The claim grant expires. An unclaimed project that nobody adopts stops
 * accepting events when its grant lapses, which is what stops `/v1/provision`
 * from being free permanent storage for anyone who can send a POST.
 */

import { Instant, Project, ProjectId, Workspace, WorkspaceId, WorkspaceLimits, CredentialId, suggestedProjectName, type AccountId } from "@counted/domain";
import { ProvisionRequestSchema, RedeemClaimRequestSchema } from "@counted/contracts";
import type { Dependencies } from "../composition";
import { publicRoute, type RouteDefinition } from "../http/route";
import { sendProblem } from "../http/respond";
import { body } from "../http/body";

/** How long a provisioned project may go unclaimed. */
export const CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The name when a caller does not supply one.
 *
 * Was the literal "Untitled project", which meant the claim page read "Claim
 * Untitled project" and a dashboard of provisioned projects was a column of
 * identical rows. `/v1/provision` takes no input by design — that is what lets
 * an agent get a key in one unauthenticated call — so something has to choose,
 * and a placeholder was the one option guaranteed to look unfinished.
 *
 * Always renameable afterwards; this only picks the starting point.
 */

/**
 * What to paste.
 *
 * Built here rather than in the web app so that an agent calling
 * `/v1/provision` gets the same snippet a human sees. Two copies of an install
 * instruction is two things to go stale, and the one that goes stale is
 * whichever the author was not looking at.
 */
const snippetFor = (key: string, endpoint: string): string =>
  [
    `import { Counted } from "@counted/sdk-js";`,
    ``,
    `const counted = new Counted({`,
    `  key: "${key}",`,
    ...(endpoint === "" ? [] : [`  endpoint: "${endpoint}",`]),
    `});`,
    ``,
    `counted.track("page_view", { path: "/" });`,
  ].join("\n");

export const bootstrapRoutes = (deps: Dependencies): readonly RouteDefinition[] => {
  const now = () => deps.clock.now();
  const claimUrl = (token: string): string => `${deps.config.appUrl.replace(/\/+$/, "")}/claim/${token}`;

  return [
    {
      method: "post",
      path: "/v1/provision",
      security: publicRoute(
        "The entry point. Requiring a credential to get a credential is circular; the grant's expiry is what bounds it.",
      ),
      handler: async (c) => {
        const parsed = await body(c, ProvisionRequestSchema);
        if (!parsed.ok) return parsed.response;

        const at = now();
        const projectId = ProjectId(deps.ids.next());
        const issued = deps.secrets.issue("ck");
        const grantToken = deps.grants.issue("claim");

        const created = Project.provisionUnclaimed(
          projectId,
          // Named at creation, always. v1 created "My Project" and then asked,
          // so the rename was a second step most people never took and every
          // list read the same.
          parsed.value.name ?? suggestedProjectName(),
          {
            digest: deps.secrets.digest(grantToken),
            expiresAt: Instant.fromEpochMillis(Instant.toEpochMillis(at) + CLAIM_TTL_MS),
          },
          {
            id: CredentialId(deps.ids.next()),
            kind: "ingest",
            label: "Default",
            digest: issued.digest,
            prefix: issued.prefix,
          },
          at,
        );
        if (!created.ok) return sendProblem(c, "request.validation_failed", { detail: created.error.kind });

        await deps.unitOfWork.transact((r) => r.projects.save(created.value.project, created.value.events));

        c.header("location", `/v1/projects/${projectId}`);
        return c.json(
          {
            project: { id: String(projectId), name: created.value.project.snapshot().name, state: "unclaimed" },
            // Disclosed once, here. The digest is what is stored.
            ingestKey: issued.secret,
            claimUrl: claimUrl(grantToken),
            claimExpiresAt: Instant.toISO(
              Instant.fromEpochMillis(Instant.toEpochMillis(at) + CLAIM_TTL_MS),
            ),
            snippet: snippetFor(issued.secret, ""),
            docsUrl: "https://counted.dev/docs",
          },
          201,
        );
      },
    },

    {
      method: "get",
      path: "/v1/claims/:token",
      security: publicRoute("A preview of what a link would adopt. Holding the link is the authorization."),
      handler: async (c) => {
        const token = c.req.param("token")!;
        const at = now();
        const project = await deps.unitOfWork.transact((r) =>
          r.projects.findByClaimDigest(deps.secrets.digest(token)),
        );

        // A link that never existed and one that has lapsed are one answer.
        // Telling them apart would let somebody test guessed tokens for
        // existence, which is the whole of the attack.
        if (project === null || project.snapshot().ownership.state !== "unclaimed") {
          return sendProblem(c, "resource.not_found", {
            detail: "This claim link is not valid. It may have expired or already been used.",
          });
        }

        const snapshot = project.snapshot();
        const ownership = snapshot.ownership;
        if (ownership.state === "unclaimed" && Instant.toEpochMillis(ownership.grant.expiresAt) <= Instant.toEpochMillis(at)) {
          return sendProblem(c, "resource.not_found", {
            detail: "This claim link is not valid. It may have expired or already been used.",
          });
        }

        // Metadata only. No key, no digest — a preview is for deciding whether
        // to sign in, not a way to read the project without doing so.
        return c.json({
          project: { id: String(snapshot.id), name: snapshot.name },
          expiresAt: ownership.state === "unclaimed" ? Instant.toISO(ownership.grant.expiresAt) : null,
        });
      },
    },

    {
      method: "post",
      path: "/v1/claims/:token/redeem",
      /**
       * The grant is the capability, so the route cannot name its resource
       * before looking it up — and the guard's resolution is synchronous by
       * design. The handler therefore requires an account itself, and the
       * membership check happens inside the same transaction that claims,
       * which is the only place it can be raced against.
       */
      security: publicRoute("The claim token names the project; the handler requires a signed-in account to own it."),
      handler: async (c) => {
        const token = c.req.param("token")!;
        const parsed = await body(c, RedeemClaimRequestSchema);
        if (!parsed.ok) return parsed.response;

        const principal = c.get("principal");
        if (principal.kind !== "account") return sendProblem(c, "auth.unauthenticated");

        const at = now();
        const outcome = await deps.unitOfWork.transact(async (r) => {
          const project = await r.projects.findByClaimDigest(deps.secrets.digest(token));
          if (project === null) return { kind: "no_such_claim" } as const;

          // Into an existing workspace this account owns, or a new one. A
          // brand-new account has none, and making them create one first would
          // be the second bootstrap path this file exists to remove.
          const existing = await r.workspaces.listForAccount(principal.account as AccountId);
          const target = parsed.value.workspaceId ?? existing[0]?.id ?? null;

          let workspaceId: WorkspaceId;
          if (target === null) {
            const opened = Workspace.open(
              WorkspaceId(deps.ids.next()),
              parsed.value.workspaceName ?? project.snapshot().name,
              principal.account as AccountId,
              WorkspaceLimits.UNLIMITED,
              at,
            );
            if (!opened.ok) return { kind: "invalid", detail: opened.error.kind } as const;
            await r.workspaces.save(opened.value.workspace, opened.value.events);
            workspaceId = opened.value.workspace.snapshot().id;
          } else {
            workspaceId = WorkspaceId(String(target));
            // Named explicitly, so a caller cannot adopt into a workspace it
            // does not belong to by guessing an id.
            if (!existing.some((w) => String(w.id) === String(workspaceId))) {
              return { kind: "not_a_member" } as const;
            }
          }

          const claimed = project.claim(deps.secrets.digest(token), workspaceId, at);
          if (!claimed.ok) return { kind: "refused", reason: claimed.error.kind } as const;

          // Rename inside the same unit of work, when the claimer chose one.
          // The alternative — claim, then PATCH — can half-fail, and the half
          // that fails leaves somebody owning a project called something they
          // just declined.
          let adopted = claimed.value.project;
          let events = claimed.value.events;
          const wanted = parsed.value.projectName;
          if (wanted !== undefined && wanted !== adopted.snapshot().name) {
            const renamed = adopted.rename(wanted, at);
            if (!renamed.ok) return { kind: "invalid", detail: renamed.error.kind } as const;
            adopted = renamed.value.project;
            events = [...events, ...renamed.value.events];
          }

          await r.projects.save(adopted, events);
          return { kind: "claimed", workspace: workspaceId, project: adopted } as const;
        });

        switch (outcome.kind) {
          case "no_such_claim":
          case "refused":
            // Collapsed, for the same reason the preview collapses them.
            return sendProblem(c, "resource.not_found", {
              detail: "This claim link is not valid. It may have expired or already been used.",
            });
          case "not_a_member":
            return sendProblem(c, "resource.not_found");
          case "invalid":
            return sendProblem(c, "request.validation_failed", { detail: outcome.detail });
          case "claimed": {
            const snapshot = outcome.project.snapshot();
            return c.json({
              workspace: { id: String(outcome.workspace) },
              project: { id: String(snapshot.id), name: snapshot.name, state: "claimed" },
            });
          }
        }
      },
    },
  ];
};
