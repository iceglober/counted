/**
 * Which contract procedures are MCP tools.
 *
 * This table is the `mcp` marker. It lives here rather than as a field on
 * `RouteSpec` because `@counted/contract` is a leaf that four things consume,
 * and only one of them is this server: a `mcp: true` in the contract would make
 * every other consumer carry a flag about a deployable it has never heard of.
 * The consequence — that adding a route does not automatically expose it — is
 * the behaviour we want. A new write surface should have to be *chosen*.
 *
 * **What this table decides, and what it does not.** It decides which tools
 * exist. It never decides who may call one. Every exposed tool is invoked with
 * the caller's own token against the same HTTP route the console calls, so the
 * refusal comes from the same policy in `apps/api` either way. Leaving
 * `projects.delete` out does not make an agent unable to delete a project — its
 * token can still do it over HTTP. It means this server does not *hand* an
 * agent a one-word way to do it. Narrowing the surface is not authorization,
 * and there is no code below that reads a permission.
 *
 * Every id here is looked up with `getProcedureContractOrThrow`, so a typo or a
 * renamed procedure fails at import, not at `tools/call`.
 */

/**
 * How a tool behaves, in the vocabulary MCP clients use to decide whether to
 * confirm with a human before calling.
 *
 * Only `title` and `hint` are written by hand. `readOnlyHint`,
 * `destructiveHint` and `idempotentHint` are derived from the route's HTTP
 * method in `projection.ts`, because the method already says it and two
 * statements of one fact drift.
 */
export type Exposure = {
  /** The contract's dotted operation id. Must name a procedure. */
  readonly id: string;
  /** Human-facing name, shown in tool pickers. The tool *name* is derived. */
  readonly title: string;
  /**
   * One sentence appended to the contract's own description, saying what an
   * agent should reach for this tool *for*. The contract describes the route;
   * this describes the use.
   */
  readonly hint?: string;
};

/**
 * The exposed set: read anything the caller can reach, build and adjust
 * dashboards, provision and claim projects, run analyses.
 */
export const EXPOSED: readonly Exposure[] = [
  { id: "account.me", title: "Who am I", hint: "Resolve the calling identity before anything else." },
  {
    id: "credentials.self",
    title: "Describe this key",
    hint: "What the key in hand reaches and what it may do. The first call after provisioning.",
  },

  { id: "workspaces.list", title: "List workspaces", hint: "Every workspace the caller reaches, with their role in each." },
  { id: "workspaces.get", title: "Get a workspace" },
  { id: "workspaces.usage", title: "Read workspace usage", hint: "Events used against the plan's allowance." },

  { id: "projects.list", title: "List projects" },
  { id: "projects.get", title: "Get a project" },
  { id: "projects.create", title: "Create a project in a workspace" },
  {
    id: "projects.provision",
    title: "Provision an unclaimed project",
    hint: "Takes no credential. Returns an ingest key that works immediately and a claim grant to attach it to a workspace later.",
  },
  {
    id: "projects.claim",
    title: "Claim a provisioned project",
    hint: "Moves a provisioned project into a workspace using the grant from provisioning.",
  },
  { id: "projects.rename", title: "Rename a project" },
  { id: "projects.setRetention", title: "Set a project's retention" },
  { id: "projects.archive", title: "Archive a project", hint: "Reversible: stops ingest, keeps the data." },
  { id: "projects.restore", title: "Restore an archived project" },

  { id: "credentials.list", title: "List keys" },
  {
    id: "credentials.listForWorkspace",
    title: "List every key in a workspace",
    hint: "Includes each project's keys and the workspace-wide ones. Revoked keys are listed too, with their status.",
  },
  { id: "credentials.issue", title: "Issue a key" },
  {
    id: "credentials.rotate",
    title: "Rotate a key",
    hint: "Issues a replacement and expires the old one after an overlap window, so a running deployment is not cut off.",
  },

  { id: "dashboards.list", title: "List dashboards" },
  { id: "dashboards.create", title: "Create a dashboard" },
  { id: "dashboards.get", title: "Get a dashboard and its tiles" },
  { id: "dashboards.layout", title: "Arrange dashboard insights" },
  { id: "dashboards.rename", title: "Rename a dashboard" },
  { id: "dashboards.setDefault", title: "Make a dashboard the project's default" },
  {
    id: "dashboards.readouts",
    title: "Read a dashboard",
    hint: "Answers every tile in one call. A tile that could not be answered says so in its own outcome; the other tiles still carry numbers.",
  },

  { id: "tiles.get", title: "Get one tile" },
  { id: "tiles.add", title: "Add a tile to a dashboard" },
  { id: "tiles.update", title: "Change a tile's analysis or view" },
  { id: "tiles.resize", title: "Change a tile's width" },
  { id: "tiles.move", title: "Move a tile to another dashboard" },
  { id: "tiles.reorder", title: "Reorder a dashboard's tiles" },
  { id: "tiles.remove", title: "Remove a tile" },

  { id: "monitors.list", title: "List a workspace's monitors" },
  { id: "monitors.listForProject", title: "List a project's monitors" },
  { id: "monitors.create", title: "Create a monitor" },
  { id: "monitors.get", title: "Get a monitor" },
  { id: "monitors.update", title: "Change a monitor" },
  { id: "monitors.enable", title: "Enable a monitor" },
  { id: "monitors.disable", title: "Disable a monitor" },

  {
    id: "queries.run",
    title: "Run one analysis",
    hint: "Ask a question directly, without a dashboard. Use `queries.schema` first to learn which events and dimensions exist.",
  },
  {
    id: "queries.schema",
    title: "Describe a project's event schema",
    hint: "Which event names and dimensions a project has actually seen. An analysis naming anything else will be refused as unanswerable.",
  },
  { id: "queries.dimensionValues", title: "List the values a dimension takes" },
];

/**
 * Procedures deliberately left out, and why. Kept as data rather than as an
 * absence so the reasoning survives the next person who wonders where
 * `dashboards.delete` went — and so a test can assert the two sets are
 * disjoint and together cover the whole contract.
 */
export const WITHHELD: readonly { readonly id: string; readonly because: string }[] = [
  {
    id: "share.view",
    because:
      "Authorized by a share token, not by the caller's credential. Exposing it would make 'every tool runs as the caller' false for two tools; the same data is reachable as the principal through dashboards.get.",
  },
  {
    id: "share.readouts",
    because:
      "Same: a share token is the whole capability. dashboards.readouts answers the same question as the caller.",
  },
  {
    id: "dashboards.share",
    because:
      "Mints a URL that needs no credential at all. Who outside the organization can see the numbers is not a decision to hand an agent a one-word way to make.",
  },
  { id: "dashboards.unshare", because: "The other half of the same decision." },
  {
    id: "projects.delete",
    because:
      "Destroys the events too, with no undo. projects.archive is the reversible half and is exposed.",
  },
  { id: "dashboards.delete", because: "No undo, and no archived state to fall back to." },
  { id: "monitors.delete", because: "No undo. monitors.disable is the reversible half and is exposed." },
  {
    id: "credentials.revoke",
    because:
      "Cuts off a running deployment instantly. credentials.rotate does the same job with an overlap window and is exposed.",
  },
  {
    id: "credentials.issueForWorkspace",
    because:
      "Mints a key that reaches the whole workspace rather than one project, which is a bigger blast radius than any tool here needs: a tool calling this runs as the human's own principal already, and projects.claim — the reason such a key exists — is exposed and works as that principal without one. credentials.issue is the project-scoped half and is exposed.",
  },
  {
    id: "workspaces.create",
    because:
      "A workspace is the billing boundary. Creating one is a commercial act, and the console is where a human makes it.",
  },
  { id: "workspaces.rename", because: "Cosmetic, and it renames the thing invoices refer to." },
  {
    id: "workspaces.members",
    because:
      "Lists people's names and email addresses. An agent building a dashboard has no use for them, and the smallest surface that does the job is the right one.",
  },
  { id: "workspaces.changeRole", because: "Changes what another human may do. Not an agent's call." },
  { id: "workspaces.removeMember", because: "Same, and it is immediate." },
  { id: "workspaces.leave", because: "Leaving a workspace is an account action confirmed in the console." },
  {
    id: "billing.plans",
    because:
      "Reading the price list is harmless and useless to an agent: nothing it can do next is a tool here, because the two routes that act on a plan are withheld below.",
  },
  {
    id: "billing.subscription",
    because:
      "What a workspace pays for is a commercial fact about the customer, not an input to building a dashboard. workspaces.get already carries the plan and the limits an agent has to respect.",
  },
  {
    id: "billing.checkout",
    because:
      "Starts a payment. An agent must not be one word away from putting a human on a card-entry page, and the console is where that decision is made.",
  },
  {
    id: "billing.portal",
    because:
      "The other half of the same decision, and it opens a page where a subscription can be cancelled.",
  },
];
