# V3-SPEC — initial architecture reference

This document records the package boundaries and interfaces established during the v3
implementation. The current source, generated contract, and tests define the interfaces
that applications compile against; examples here retain the initial implementation shape.

Historical validation snapshot:

```
bun run typecheck   tsc -p tsconfig.json --noEmit          green
bun run arch        depcruise packages apps                green — 122 modules, 154 deps
bun run test        bun test <packages> && react           green — 210 tests
bun run openapi:generate                                    writes openapi.json (OpenAPI 3.1.2)
```

---

## 1. Package layout

Context-first, layers enforced inside. Every package is `private`, `type: module`, version
`0.0.0`, and points `main`/`types`/`exports` at **source** — Bun runs TypeScript directly, so
there is no build step for internal packages.

| Package | Name | Responsibility |
|---|---|---|
| `packages/kernel` | `@counted/kernel` | Shared value objects, ids, `Result`, the authorization vocabulary. Zero dependencies. |
| `packages/kernel` (subpath) | `@counted/kernel/ports` | `Clock`, `IdGenerator`, `Notifier` — the three capabilities more than one context needs. **No domain may import this.** |
| `packages/authorization` | `@counted/authorization` | Q1 role→permission (`accesscontrol`, wrapped) and Q2 binding. The only package that may import `accesscontrol`. |
| `packages/identity/ports` | `@counted/identity-ports` | `AccountDirectory`, `MembershipDirectory`, `CredentialStore`. |
| `packages/identity/adapter-better-auth` | `@counted/identity-adapter-better-auth` | better-auth behind those ports. The only package that may import `better-auth` or `@better-auth/*`. |
| `packages/persistence/ports` | `@counted/persistence-ports` | `UnitOfWork`, `Outbox` — the transaction boundary that spans contexts. |
| `packages/tenancy/domain` | `@counted/tenancy-domain` | Workspace as a business aggregate: plan catalog, entitlements, limits. |
| `packages/tenancy/ports` | `@counted/tenancy-ports` | `WorkspaceRepository`, `SubscriptionRepository`, `BillingGateway`, `WebhookLedger`. |
| `packages/tenancy/app` | `@counted/tenancy-app` | Create a workspace, change a plan, apply a billing event. |
| `packages/projects/domain` | `@counted/projects-domain` | Project aggregate; every rule about credentials, including the grant-subset rule. |
| `packages/projects/ports` | `@counted/projects-ports` | `ProjectRepository`. |
| `packages/projects/app` | `@counted/projects-app` | Provision, rename, archive, delete; issue and rotate credentials. |
| `packages/ingestion/domain` | `@counted/ingestion-domain` | `IngestBatch`, admission, dedup, the person/visit separation. |
| `packages/ingestion/ports` | `@counted/ingestion-ports` | `EventSink`, `IngestQuota`. |
| `packages/ingestion/app` | `@counted/ingestion-app` | Group-commit coalescer policy. Not the transport. |
| `packages/analytics/domain` | `@counted/analytics-domain` | Analysis IR — what to measure, over what window, sliced how. No state, no SQL. |
| `packages/analytics/ports` | `@counted/analytics-ports` | `AnalyticsEngine`, `SchemaCatalog`. |
| `packages/analytics/app` | `@counted/analytics-app` | Translate an Analysis into engine calls; assemble readouts. |
| `packages/analytics/adapter-litics` | `@counted/analytics-adapter-litics` | `AnalyticsEngine` over `@litics/core` + `pg`. The only package that may import `@litics/core`. |
| `packages/dashboarding/domain` | `@counted/dashboarding-domain` | `Dashboard`, `Tile`, `ShareGrant`, `Monitor`. |
| `packages/dashboarding/ports` | `@counted/dashboarding-ports` | `DashboardRepository`, `MonitorRepository`. |
| `packages/dashboarding/app` | `@counted/dashboarding-app` | Dashboard and monitor use cases; readout rendering. |
| `packages/contract` | `@counted/contract` | The oRPC v2 contract. One description of every route, four consumers. A leaf. |
| `packages/adapters/postgres` | `@counted/adapter-postgres` | Repositories, unit of work, outbox over `pg`. Shared across contexts. |
| `packages/adapters/stripe` | `@counted/adapter-stripe` | `BillingGateway` over Stripe. Tenancy only. |
| `packages/adapters/notify` | `@counted/adapter-notify` | `Notifier` over email and webhooks. |
| `packages/adapters/crypto` | `@counted/adapter-crypto` | `IdGenerator` and digesting. The only randomness in the system. |
| `apps/api` | `@counted/api-server` | oRPC router + three hand-written routes + better-auth's handler. The composition root. |
| `apps/web` | `@counted/web` | The console. A contract client and a forwarding proxy — holds no credential of its own. |
| `apps/mcp` | `@counted/mcp-server` | MCP tools projected from the contract. |
| `apps/worker` | `@counted/worker` | Outbox dispatch, monitor evaluation, retention purge. |

Surviving from v2, untouched: `packages/sdk-js`, `packages/react`, `packages/python`,
`packages/go`, `packages/rust`, `packages/agent-*`, `packages/migrate`,
`packages/aptabase-compat`, `contract/`.

### Where third-party dependencies are declared

All of them at the **repo root**, so there is one version of each and no drift. A package's
own `package.json` declares only its `workspace:*` dependencies. Ownership of a library is
enforced by `.dependency-cruiser.cjs`, not by which manifest mentions it.

Pinned exactly, no caret, because a caret on a prerelease floats:
`@orpc/{server,client,contract,openapi,zod}@2.0.0-beta.32`, `better-auth@1.7.2`,
`@better-auth/api-key@1.7.2`, `@better-auth/mcp@1.7.2`, `accesscontrol@3.1.0`.
`@litics/core` is vendored under `vendor/litics-core`; its source revision is recorded in
`VENDORED.json`.
`@litics/kysely` is **not** installed and Kysely does not enter this stack — it appears in the
lockfile only because better-auth uses it internally.

---

## 2. The eight rules, and how to know they work

`.dependency-cruiser.cjs` implements all eight from the brief plus five more. Test files are
**not** exempt — v2 excluded `*.test.ts` from every rule, which meant a test could import a
database driver into the domain and the proof stayed green. The only concession is `bun:test`,
allowed by name everywhere.

1. `domain-is-pure` / `domain-has-no-io` — a domain imports `@counted/kernel` and its own
   context. Nothing else, and no Node builtins.
2. `app-knows-only-its-domain-kernel-and-ports` — a use case imports its own domain, the
   kernel, and `*/ports`. **Not `@counted/authorization`**: the authorization decision runs in
   `apps/*` before the use case, so a use case that re-checked it would be a second policy.
3. `only-the-identity-adapter-knows-better-auth`
4. `only-authorization-knows-accesscontrol`
5. `only-the-analytics-adapter-knows-litics`
6. `contract-is-a-leaf` (+ `no-inner-layer-imports-the-contract`)
7. `no-cross-context-domain`
8. `no-circular`

Plus `domain-takes-values-not-capabilities`, `ports-declare-only`, `adapters-know-no-apps`,
`apps-are-independent`, `the-console-holds-no-credential`, `not-to-unresolvable`.

**Three settings silently made these rules enforce nothing, and each was found by planting a
violation rather than by reading the config.** If you add a rule, plant a violation and watch
it fail before you trust it.

- Without `tsPreCompilationDeps: true`, dependency-cruiser analyses the *transpiled* module and
  every `import type` disappears. A ports package is nothing but types, so the rules covering
  them enforced nothing at all.
- An `exclude` on `/dist/` and `\.d\.ts$` hides every vendor import, because
  `node_modules/<pkg>/dist/index.d.ts` is exactly where a library's types live. Four rules were
  no-ops. The exclude is now anchored to `^(packages|apps)/.*/dist/`.
- Matching npm packages by bare name misses them once they resolve — Bun stores real files at
  `node_modules/.bun/<name>@<version>/node_modules/<name>/…`. The `npm()` helper at the top of
  the config matches both spellings, as does every workspace-package pattern (an undeclared
  import shows up as a bare `@counted/…` name, which is exactly what a boundary violation
  usually looks like).

---

## 3. Kernel — the exact signatures

`import { … } from "@counted/kernel"` — everything below except `./ports`.

### Brands

```ts
export type Brand<T, B extends string> = T & { readonly [BRAND]: B };

export function unbrand<B extends string>(value: Brand<string, B>): string;
export function unbrand<B extends string>(value: Brand<number, B>): number;

export const assertNever: (value: never, message?: string) => never;
```

`unbrand` is two overloads and not one generic on purpose. A brand is an intersection, so
`<T>(value: Brand<T, B>) => T` infers `T` as the *whole* intersection: it compiles everywhere
and strips nothing. Constraining `T extends string | number` does not help — `string & {…}`
satisfies `extends string`.

### Result

```ts
export type Ok<T>  = { readonly ok: true;  readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok:        <T>(value: T) => Ok<T>;
export const err:       <E>(error: E) => Err<E>;
export const isOk:      <T, E>(r: Result<T, E>) => r is Ok<T>;
export const isErr:     <T, E>(r: Result<T, E>) => r is Err<E>;
export const map:       <T, U, E>(r: Result<T, E>, f: (value: T) => U) => Result<U, E>;
export const mapErr:    <T, E, F>(r: Result<T, E>, f: (error: E) => F) => Result<T, F>;
export const flatMap:   <T, U, E>(r: Result<T, E>, f: (value: T) => Result<U, E>) => Result<U, E>;
export const unwrapOr:  <T, E>(r: Result<T, E>, fallback: T) => T;
export const all:       <T, E>(results: readonly Result<T, E>[]) => Result<T[], E>;
export const partition: <T, E>(results: readonly Result<T, E>[]) => { readonly values: T[]; readonly errors: E[] };
```

`all` fails the whole batch on the first `Err`. `partition` keeps both halves — that is the
ingest-batch case, where some events are accepted and some rejected.

### Duration

```ts
export type Duration = Brand<number, "Duration">;

export const Duration: {
  millis(n: number): Duration;  seconds(n: number): Duration;
  minutes(n: number): Duration; hours(n: number): Duration;
  days(n: number): Duration;    // exactly 24 hours, never "a calendar day"
  toMillis(d: Duration): number;   toSeconds(d: Duration): number;
  add(a: Duration, b: Duration): Duration;
  subtract(a: Duration, b: Duration): Duration;
  multiply(d: Duration, factor: number): Duration;
  compare(a: Duration, b: Duration): number;
  isZero(d: Duration): boolean;   isNegative(d: Duration): boolean;
  ZERO: Duration;
};
```

There is no `Duration.months`. A month is a boundary, not a length. Calendar arithmetic is
litics' now — see §7.

### Instant

```ts
export type Instant = Brand<number, "Instant">;
export type InstantParseError = { readonly kind: "NotAnInstant"; readonly raw: string };

export const isInstant: (value: unknown) => value is Instant;

export const Instant: {
  fromEpochMillis(n: number): Instant;   // trusts its caller; use isInstant on outside input
  toEpochMillis(i: Instant): number;
  fromDate(d: Date): Instant;            toDate(i: Instant): Date;
  toISO(i: Instant): string;             // ISO-8601 UTC, the only string form
  fromISO(raw: string): Result<Instant, InstantParseError>;   // fallible, and says so
  plus(i: Instant, d: Duration): Instant;
  minus(i: Instant, d: Duration): Instant;
  between(a: Instant, b: Instant): Duration;  // signed
  compare(a: Instant, b: Instant): number;
  isBefore(a, b): boolean; isAfter(a, b): boolean; equals(a, b): boolean;
  min(a, b): Instant;      max(a, b): Instant;
  EPOCH: Instant;
};
```

### Ids

Nine branded string ids, each with a constructor and a guard:

```ts
export const MAX_ID_LENGTH = 128;

export type WorkspaceId  = Brand<string, "WorkspaceId">;   // + ProjectId, DashboardId, TileId,
export const WorkspaceId: (raw: string) => WorkspaceId;    //   MonitorId, AccountId,
export const isWorkspaceId: (v: unknown) => v is WorkspaceId; // CredentialId, VisitId, PersonId
```

Full set: `WorkspaceId`, `ProjectId`, `DashboardId`, `TileId`, `MonitorId`, `AccountId`,
`CredentialId`, `VisitId`, `PersonId`; guards `isWorkspaceId` … `isPersonId`.

**A guard cannot tell one brand from another.** Brands are erased at runtime and every id is an
opaque string. The guards answer the one answerable question — is this a usable identifier:
a string, non-empty, no whitespace, within `MAX_ID_LENGTH`. Use them where untrusted input
becomes an id; never to decide *which kind* of id you are holding. There is a test asserting
this so nobody later mistakes them for discriminators.

### Events

```ts
export type DomainEvent = { readonly kind: string; readonly at: Instant };

export type EventEnvelope<E extends DomainEvent = DomainEvent> = {
  readonly id: string;          // stable across redeliveries; travels as `webhook-id`
  readonly type: string;        // "<context>.<Kind>", e.g. "dashboarding.TileAdded"
  readonly occurredAt: Instant;
  readonly payload: E;
};
```

**Every context's event union must extend `DomainEvent`** — a `kind` discriminant and an `at`.
The repositories' `save` signatures are constrained on it.

### Authorization vocabulary

```ts
export type Role = "owner" | "admin" | "member";
export const ROLES: readonly Role[];
export const Role: {
  rank(r: Role): number;
  atLeast(actual: Role, required: Role): boolean;
  is(value: unknown): value is Role;
};

export type Permission = /* the fifteen below */;
export const ALL_PERMISSIONS: readonly Permission[];
export const isPermission: (value: unknown) => value is Permission;
export type PermissionResource; export type PermissionAction;
export const splitPermission: (p: Permission) => { resource: PermissionResource; action: PermissionAction };
```

The vocabulary lives in the kernel, not in `@counted/authorization`, for one mechanical reason:
`@counted/contract` needs it to emit OpenAPI `security` blocks, and the contract is a leaf that
may import only `@orpc/*`, `zod` and the kernel. The kernel says what the words are;
`@counted/authorization` says who gets what.

### `@counted/kernel/ports`

```ts
export interface Clock { now(): Instant }
export const fixedClock: (at: Instant) => Clock;
export const scriptedClock: (start: Instant) => Clock & { advance(by: Duration): void };

export interface IdGenerator { next(): string }

export type Notification =
  | { channel: "email";   to: string; subject: string; body: string }
  | { channel: "webhook"; url: string; id: string; payload: unknown };

export interface Notifier { deliver(notification: Notification): Promise<void> }
```

Deliberately not re-exported from the kernel root, and forbidden to every domain package by
`domain-takes-values-not-capabilities`. A domain function is handed the `Instant` it acts at
and the id it mints with.

---

## 4. Permissions and roles

Fifteen permissions. v2 had sixteen; `events:read` was granted by roles and required by no
route, so it is **dropped rather than ported** — a permission nothing checks cannot be reasoned
about. `projects:delete` was dropped for the same reason and is **back**, because a route now
requires it: see the resolved question below.

| Permission | Held by |
|---|---|
| `queries:run` | member, admin, owner |
| `projects:read` | member, admin, owner |
| `dashboards:read` | member, admin, owner |
| `dashboards:write` | member, admin, owner |
| `monitors:read` | member, admin, owner |
| `monitors:write` | member, admin, owner |
| `workspace:read` | member, admin, owner |
| `events:write` | admin, owner |
| `projects:write` | admin, owner |
| `credentials:read` | admin, owner |
| `credentials:write` | admin, owner |
| `billing:read` | admin, owner |
| `projects:delete` | owner |
| `workspace:admin` | owner |
| `billing:write` | owner |

Three roles: **member** reads, and writes the things that are cheap to undo — dashboards and
monitors. **admin** adds projects, credentials, and reading billing. **owner** adds deleting a
project, workspace administration, and paying.

`@counted/authorization/src/grants.ts` writes this as data and expands it through
`accesscontrol`. That library speaks action-on-resource (`create:project`); Counted speaks flat
`resource:action`. The translation happens **inside that one module**, which is what makes
replacing the library a one-file change. `ac.can(...)` must never appear in a route handler.

**Resolved: `projects:delete` is a permission, and there is no role floor.** The provisional
answer — `projects:write` plus an owner-role check at the procedure — could not be expressed by
`decide`, so the server ran it as a second check standing next to the decision, with nothing
comparing the two. That is the defect `@counted/authorization` exists to prevent, and it is the
same shape as the v2 bug where security was declared twice. Deletion is owner-only authority,
the grant table already says who is an owner, so deletion is a permission:
`AuthorizationRequirement` has no `minimumRole`, `decide` has no floor, and
`DELETE /v1/projects/{projectId}` requires `projects:delete`.

`projects:delete` **is** delegable to a service key, unlike `workspace:admin` and
`billing:write`. An owner-issued key can tear down a project it provisioned; an admin-issued
one cannot, because an admin does not hold the permission. That is exactly the rule the floor
was reaching for.

**The grant-subset rule (Q3).** No credential may carry a permission its issuer does not hold.
v2 had no such check: issuing required `credentials:write`, which admin holds, while
`workspace:admin` and `billing:write` are owner-only — so an admin could mint a service key
carrying owner permissions and act through it. v3 fixes it by construction (better-auth's
server-only permissions mean the client cannot name them at all) *and* states the rule in
`@counted/projects-domain`.

**Q3 is stated exactly once, and it is stated there.** `withinGrant` and `grantableTo` in
`@counted/projects-domain` are the rule; they take the issuer's holdings as a **value**,
because a domain may not import `@counted/authorization`. Two other copies existed and are
gone: `grantable(role, requested)` in `@counted/authorization`, which nothing called, and
`grantablePermissions(kind, role, grants)` in `@counted/identity-ports`, which had no
credential-kind ceiling — so the store derived a service key carrying all fifteen permissions
for an owner, the projects app refused it as an escalation, and the key was minted and revoked
in the same call. An owner could not issue a service key.

The seam that replaced them: `@counted/identity-ports` declares
`CredentialGrants = (kind, role) => readonly Permission[]` and imports neither half.
`apps/api/src/auth/grants.ts` is the one composition —
`grantableTo(kind, permissionsForRole(role))` — wired into the better-auth adapter and every
fake. `@counted/identity-ports/testing` restates the table as a double because a ports package
may import neither owner; `apps/api/src/auth/grants.test.ts` asserts the double equals the real
composition, role by role and kind by kind.

**Routes with nothing to place** — "list my workspaces", "create a workspace", "what is this
key" — go to `decideUnplaced(principal, need, standings)` in `@counted/authorization`, not to a
check the composition root writes for itself. `decide` needs a `Placement` and these have no
resource; before this existed, `apps/api` expanded roles in a `reach.some(...)` of its own,
which is a second policy in the layer that is supposed to have none.

---

## 5. Ports — the exact interfaces

### The type-parameter convention, and why

Aggregates live in `<ctx>/domain` and were written **after** these ports. Rather than have the
ports forward-reference types that do not exist yet — which would leave every agent staring at
a red tree that is not their fault — repositories are **generic in the aggregate and its event
type**. This is also defensible on its own terms: a storage contract needs to know an id goes
in and a value comes out, not what is inside the value.

Close the parameters **once**, in the context's `app` package:

```ts
// packages/tenancy/app/src/ports.ts
import type { Workspace, WorkspaceEvent } from "@counted/tenancy-domain";
import type { WorkspaceRepository as Repo } from "@counted/tenancy-ports";
export type WorkspaceRepository = Repo<Workspace, WorkspaceEvent>;
```

**Pinned aggregate and event names**, so those aliases are identical in every context:

| Context | Aggregate | Event union | Error union |
|---|---|---|---|
| tenancy | `Workspace` | `WorkspaceEvent` | `WorkspaceError` |
| tenancy (billing) | `Subscription`, `Plan`, `PlanId`, `PlanLimits` | `BillingEvent` | — |
| projects | `Project` | `ProjectEvent` | `ProjectError` |
| dashboarding | `Dashboard<A>`, `Tile<A>`, `ShareGrant` | `DashboardEvent` | `DashboardError` |
| dashboarding | `Monitor<A>`, `Threshold` | `MonitorEvent` | `MonitorError` |
| analytics | `Analysis`, `Window`, `Grain`, `Measure`, `Predicate`, `Funnel` | — | `AnalysisError` |
| ingestion | `IngestBatch`, `AdmittedEvent` | — | `AdmissionError` |

### `@counted/kernel/ports`

See §3.

### `@counted/persistence-ports`

```ts
export interface UnitOfWork<Repositories> {
  transact<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}

export interface Outbox {
  enqueue(events: readonly EventEnvelope[]): Promise<void>;   // inside transact, never outside
  claim(limit: number): Promise<readonly EventEnvelope[]>;
  markDispatched(ids: readonly string[], at: Instant): Promise<void>;
  recordFailure(id: string, error: string, at: Instant): Promise<number>;
  pendingCount(): Promise<number>;
}
```

`transact` commits when `work` resolves and rolls back when it throws. **A `Result` returned
from `work` is a successful transaction reporting a refused rule — it commits.** If a rule
violation must roll back, throw.

`UnitOfWork` is generic in the repository bundle because the bundle is chosen by the
composition root, which is the only place that knows which contexts are deployed together.

### `@counted/identity-ports`

```ts
export type Account = {
  id: AccountId; email: string; name: string | null;
  emailVerified: boolean; createdAt: Instant;
};

export interface AccountDirectory {
  find(id: AccountId): Promise<Account | null>;
  findByEmail(email: string): Promise<Account | null>;
  findMany(ids: readonly AccountId[]): Promise<ReadonlyMap<AccountId, Account>>;
}

export type Membership = { account: AccountId; role: Role; since: Instant };

export interface MembershipDirectory {
  roleOf(account: AccountId, workspace: WorkspaceId): Promise<Role | null>;
  membersOf(workspace: WorkspaceId): Promise<readonly Membership[]>;
}
```

`MembershipDirectory` is **read-only, permanently**. There is no `add`, no `remove`, no
`changeRole`: better-auth's organization plugin owns `organization`, `member` and `invitation`,
and writes go through its API. A better-auth organization row and a domain workspace row share
an id and mean different things — who belongs here versus what plan and what limits.

```ts
export type CredentialKind = "ingest" | "service";

export type CredentialSummary = {
  id: CredentialId; kind: CredentialKind; name: string; hint: string;
  workspace: WorkspaceId; project: ProjectId | null;
  permissions: readonly Permission[]; issuedBy: AccountId;
  createdAt: Instant; expiresAt: Instant | null;
  lastUsedAt: Instant | null; revokedAt: Instant | null;
};

export type IssueRequest = {
  kind: CredentialKind; name: string;
  workspace: WorkspaceId; project: ProjectId | null;
  issuedBy: AccountId; expiresIn: Duration | null;
};

export type IssuedCredential   = { credential: CredentialSummary; secret: string };
export type VerifiedCredential = {
  id: CredentialId; kind: CredentialKind; workspace: WorkspaceId;
  project: ProjectId | null; permissions: readonly Permission[]; issuedBy: AccountId;
};

export type IssueFailure =
  | { kind: "NoSuchWorkspace"; workspace: WorkspaceId }
  | { kind: "NoSuchProject"; project: ProjectId }
  | { kind: "IssuerNotAMember"; account: AccountId }
  | { kind: "NothingGrantable"; account: AccountId };

export type VerificationFailure =
  | { kind: "Unknown" }
  | { kind: "Revoked"; at: Instant }
  | { kind: "Expired"; at: Instant }
  | { kind: "RateLimited"; retryAfter: Duration };

export type RotatedCredential = { issued: IssuedCredential; retiring: CredentialSummary };
export type RotationFailure   = { kind: "UnknownCredential" | "AlreadyRevoked"; credential: CredentialId };
export type RevocationFailure = { kind: "UnknownCredential" | "AlreadyRevoked"; credential: CredentialId };

export type CredentialScope =
  | { level: "workspace"; workspace: WorkspaceId }
  | { level: "project";   project: ProjectId };

export interface CredentialStore {
  issue(request: IssueRequest, at: Instant): Promise<Result<IssuedCredential, IssueFailure>>;
  verify(secret: string, at: Instant): Promise<Result<VerifiedCredential, VerificationFailure>>;
  rotate(credential: CredentialId, overlap: Duration, at: Instant): Promise<Result<RotatedCredential, RotationFailure>>;
  revoke(credential: CredentialId, at: Instant): Promise<Result<void, RevocationFailure>>;
  list(scope: CredentialScope): Promise<readonly CredentialSummary[]>;
}
```

Three things to hold on to.

- **`IssueRequest` has no `permissions` field, and never will.** `@better-auth/api-key` treats
  `permissions` as a server-only property and rejects a client request that names them. That is
  a stronger fix than a grant-subset check, because the request body v2's escalation hole
  depended on stops existing. The set is computed from `kind` and the issuer's role.
- **`Unknown` / `Revoked` / `Expired` are reported separately here and collapsed into
  `anonymous` by whoever builds a Principal.** Distinct at this layer so the audit log can say
  which happened; collapsed at the boundary so a timing or message difference does not tell an
  attacker which of their guesses exists. `RateLimited` does **not** collapse — it is a 429.
- **`rotate` is create-new plus expire-old.** There is no rotate primitive underneath, and the
  overlap window is a product decision, which is why it is a parameter here and a policy in
  `@counted/projects-app`.

### `@counted/tenancy-ports`

```ts
export type WorkspaceSummary = { id: WorkspaceId; name: string; role: Role };

export interface WorkspaceRepository<Workspace, WorkspaceEvent extends DomainEvent> {
  find(id: WorkspaceId): Promise<Workspace | null>;
  listForAccount(account: AccountId): Promise<readonly WorkspaceSummary[]>;
  save(workspace: Workspace, events: readonly WorkspaceEvent[]): Promise<void>;
}

export interface BillingGateway<PlanId extends string, BillingEvent> {
  createCheckoutSession(request: CheckoutRequest<PlanId>): Promise<HostedSession>;
  createPortalSession(request: PortalRequest): Promise<HostedSession>;
  verifyWebhook(body: string, signature: string | undefined, at: Instant):
    Result<VerifiedWebhook<BillingEvent>, WebhookRejection>;
}

export interface SubscriptionRepository<Subscription> {
  find(workspace: WorkspaceId): Promise<Subscription | null>;
  findByCustomer(customer: string): Promise<Subscription | null>;
  findBySubscriptionRef(subscription: string): Promise<Subscription | null>;
  save(subscription: Subscription): Promise<void>;   // upsert — there is no update-shaped method
}

export interface WebhookLedger {
  claim(id: string, type: string, at: Instant): Promise<boolean>;  // false = already seen
  markProcessed(id: string, at: Instant): Promise<void>;
}

export type HostedSession   = { url: string; expiresAt: Instant | null };
export type CheckoutRequest<PlanId extends string> = {
  workspace: WorkspaceId; plan: PlanId; cadence: "monthly" | "annual";
  customer: string | null; successUrl: string; cancelUrl: string;
};
export type PortalRequest   = { customer: string; returnUrl: string };
export type VerifiedWebhook<BillingEvent> = {
  id: string; type: string; workspace: WorkspaceId | null; event: BillingEvent | null;
};
export type WebhookRejection =
  | { kind: "BadSignature" } | { kind: "Stale"; ageSeconds: number } | { kind: "Malformed"; detail: string };
```

### `@counted/projects-ports`

```ts
export type ProjectSummary = { id: ProjectId; workspace: WorkspaceId; name: string; archived: boolean };

export interface ProjectRepository<Project, ProjectEvent extends DomainEvent> {
  find(id: ProjectId): Promise<Project | null>;
  listForWorkspace(workspace: WorkspaceId): Promise<readonly Project[]>;
  summariesForWorkspace(workspace: WorkspaceId): Promise<readonly ProjectSummary[]>;
  save(project: Project, events: readonly ProjectEvent[]): Promise<void>;
  delete(id: ProjectId): Promise<void>;
}
```

No credential methods. The rows belong to better-auth; the *rules* about them are in
`@counted/projects-domain`.

### `@counted/dashboarding-ports`

```ts
export type DashboardSummary = {
  id: DashboardId; workspace: WorkspaceId; name: string; tileCount: number; shared: boolean;
};

export interface DashboardRepository<Dashboard, DashboardEvent extends DomainEvent> {
  find(id: DashboardId): Promise<Dashboard | null>;
  findByShareDigest(digest: string): Promise<Dashboard | null>;
  listForWorkspace(workspace: WorkspaceId): Promise<readonly DashboardSummary[]>;
  projectsReadBy(dashboard: DashboardId): Promise<readonly ProjectId[]>;
  save(dashboard: Dashboard, events: readonly DashboardEvent[]): Promise<void>;
  delete(id: DashboardId): Promise<void>;
}

export interface MonitorRepository<Monitor, MonitorEvent extends DomainEvent> {
  find(id: MonitorId): Promise<Monitor | null>;
  listForProject(project: ProjectId): Promise<readonly Monitor[]>;
  listForWorkspace(workspace: WorkspaceId): Promise<readonly Monitor[]>;
  listEnabled(limit: number): Promise<readonly Monitor[]>;
  save(monitor: Monitor, events: readonly MonitorEvent[]): Promise<void>;
  delete(id: MonitorId): Promise<void>;
}
```

`projectsReadBy` exists because a share grant's binding is derived from exactly that set: a
share link may run the queries the page it shows needs, and no others.

### `@counted/analytics-ports`

```ts
export type EngineScope =
  | { level: "workspace"; workspace: WorkspaceId }
  | { level: "project";   project: ProjectId };

export type Bounds  = { from: Instant; to: Instant };
export type Step    = "hour" | "day" | "week" | "month";
export type Filters = Readonly<Record<string, string>>;

export type SeriesQuery = { scope: EngineScope; bounds: Bounds; step: Step; event?: string; filters?: Filters };
export type SumsQuery   = SeriesQuery & { measure: string };
export type Bucket      = { start: Instant; value: number };
export type Series      = { buckets: readonly Bucket[] };   // dense: one bucket per interval, zeros included

export type FunnelSteps  = readonly [string, string, string];   // exactly three — litics' shape
export type FunnelQuery  = { scope: EngineScope; bounds: Bounds; steps: FunnelSteps; within?: Duration };
export type FunnelCounts = { counts: readonly [number, number, number] };

export type RetentionQuery = { scope: EngineScope; bounds: Bounds; cohortStep: Step; periods: number };

export type MissingFeature = "retention" | "group_by" | "nested_predicates";

export type EngineFailure =
  | { kind: "Timeout"; budget: Duration }
  | { kind: "Unavailable"; detail: string }
  | { kind: "InvalidQuery"; detail: string }
  | { kind: "NotImplemented"; feature: MissingFeature };

export type EngineOutcome<T> =
  | { ok: true; value: T; computedAt: Instant }
  | { ok: false; error: EngineFailure };

export type NotImplemented<F extends MissingFeature> = {
  ok: false; error: { kind: "NotImplemented"; feature: F };
};

export type QueryOptions = { deadline: Duration; signal?: AbortSignal; traceId: string };

export interface AnalyticsEngine {
  counts(query: SeriesQuery, options: QueryOptions): Promise<EngineOutcome<Series>>;
  uniques(query: SeriesQuery, options: QueryOptions): Promise<EngineOutcome<Series>>;
  sums(query: SumsQuery, options: QueryOptions): Promise<EngineOutcome<Series>>;
  funnel(query: FunnelQuery, options: QueryOptions): Promise<EngineOutcome<FunnelCounts>>;
  retention(query: RetentionQuery, options: QueryOptions): Promise<NotImplemented<"retention">>;
}

export interface SchemaCatalog {
  eventNames(project: ProjectId): Promise<readonly string[]>;
  dimensions(project: ProjectId): Promise<readonly string[]>;
  dimensionValues(project: ProjectId, dimension: string, limit: number): Promise<readonly string[]>;
  measures(project: ProjectId): Promise<readonly string[]>;
}
```

`retention` returns a type that **can only fail**, so the compiler tells every caller there is
no success branch to write. That is the point: the console renders "not available yet" rather
than an empty grid nobody can distinguish from "no data". When litics grows it, widen the
return type to `Promise<EngineOutcome<RetentionGrid>>` and every caller stops compiling until
it handles success.

`Filters` being flat dimension equality is the honest boundary, not a simplification. A cube
can only answer filters over the dimensions it was built with; anything richer is a raw scan
and gives up the thing that makes reads fast. `dimensionValues` exists because litics has no
group-by, so a breakdown is one query per value — which is why `limit` is required.

### `@counted/ingestion-ports`

```ts
export type WriteReceipt = { written: number; deduplicated: number };
export type WriteFailure =
  | { kind: "SinkUnavailable"; detail: string }
  | { kind: "Timeout" }
  | { kind: "NoPartition"; at: Instant };

export interface EventSink<AdmittedEvent> {
  writeBatch(project: ProjectId, events: readonly AdmittedEvent[]): Promise<Result<WriteReceipt, WriteFailure>>;
}

export type QuotaVerdict =
  | { kind: "Allowed"; remaining: number | null }
  | { kind: "PlanExceeded"; limit: number; used: number }
  | { kind: "RateLimited"; retryAfter: Duration };

export interface IngestQuota {
  check(project: ProjectId, count: number, at: Instant): Promise<QuotaVerdict>;
  record(workspace: WorkspaceId, count: number, at: Instant): Promise<void>;
}
```

`writeBatch`, never `write` — the batch is the unit that gets refused, because refusing half of
one leaves the client unable to say what landed.

---

## 6. Domain errors → oRPC codes

**This table is what stops seven agents inventing seven error conventions.** Use it. If your
context needs an error that is not here, add a row, and say so in your hand-off.

Three rules that hold everywhere:

1. **`.errors({...})` keys come from oRPC's closed 22-code vocabulary.** `TOO_MANY_TILES` is a
   type error. The domain error name travels in `data`, never in the code.
2. **`ErrorMapItem` is `{ message?: string; data?: ZodSchema }`. There is no `status` field.**
   The status is implied by the code.
3. **Every `data` is `z.object({ reason: z.literal("<DomainErrorKind>"), …fields })`**, where
   `reason` is exactly the domain error's `kind`. Where several kinds share one code, `reason`
   is a union of literals and the code is declared once with a discriminated union in `data`.

```ts
.errors({
  CONFLICT: {
    message: "Tile limit reached",
    data: z.object({ reason: z.literal("TooManyTiles"), max: z.number() }),
  },
})
// in the handler:
throw errors.CONFLICT({ data: { reason: "TooManyTiles", max: 24 } });
```

Verified: a declared error appears in the generated OpenAPI document at its mapped status, with
`data` fully expanded from the Zod schema.

### Tenancy — `WorkspaceError`

| `kind` | Code | `data` fields beyond `reason` |
|---|---|---|
| `NameRequired` | `BAD_REQUEST` | — |
| `AlreadyAMember` | `CONFLICT` | `account` |
| `NotAMember` | `NOT_FOUND` | `account` |
| `RoleUnchanged` | `CONFLICT` | `account`, `role` |
| `LastOwner` | `CONFLICT` | `account` |
| `SeatLimitReached` | `PAYMENT_REQUIRED` | `limit` |
| `ProjectExists` | `CONFLICT` | `project` |
| `NoSuchProject` | `NOT_FOUND` | `project` |
| `ProjectAlreadyArchived` | `CONFLICT` | `project` |
| `ProjectLimitReached` | `PAYMENT_REQUIRED` | `limit` |

### Tenancy — billing

| `kind` | Code | `data` |
|---|---|---|
| `NoSubscription` | `NOT_FOUND` | `workspace` |
| `PlanUnavailable` | `UNPROCESSABLE_CONTENT` | `plan` |
| `BadSignature` | `BAD_REQUEST` | — |
| `Stale` | `BAD_REQUEST` | `ageSeconds` |
| `Malformed` | `BAD_REQUEST` | `detail` |
| `ProviderUnavailable` | `BAD_GATEWAY` | `detail` |

### Projects — `ProjectError`

| `kind` | Code | `data` |
|---|---|---|
| `NameRequired` | `BAD_REQUEST` | — |
| `NameUnchanged` | `CONFLICT` | — |
| `NoSuchProject` | `NOT_FOUND` | `project` |
| `FirstCredentialMustIngest` | `UNPROCESSABLE_CONTENT` | — |
| `PermissionsRequired` | `BAD_REQUEST` | — |
| `PermissionEscalation` | `FORBIDDEN` | `requested`, `held` |
| `CredentialExists` | `CONFLICT` | `credential` |
| `UnknownCredential` | `NOT_FOUND` | `credential` |
| `CredentialRevoked` | `GONE` | `credential` |
| `CredentialExpired` | `GONE` | `credential` |
| `LastIngestCredential` | `CONFLICT` | `credential` |
| `RotationKindMismatch` | `UNPROCESSABLE_CONTENT` | — |
| `AlreadyClaimed` | `CONFLICT` | — |
| `GrantExpired` | `GONE` | — |
| `GrantMismatch` | `FORBIDDEN` | — |

`ScopesRequired` is renamed `PermissionsRequired`: `Scope` became `Permission` in v3.

### Dashboarding — `DashboardError`

| `kind` | Code | `data` |
|---|---|---|
| `NameRequired` | `BAD_REQUEST` | — |
| `NameUnchanged` | `CONFLICT` | — |
| `TileTitleRequired` | `BAD_REQUEST` | — |
| `TileExists` | `CONFLICT` | `tile` |
| `NoSuchTile` | `NOT_FOUND` | `tile` |
| `TooManyTiles` | `CONFLICT` | `max` |
| `InvalidWidth` | `BAD_REQUEST` | `width` |
| `WidthUnchanged` | `CONFLICT` | `tile` |
| `IndexOutOfRange` | `BAD_REQUEST` | `index`, `size` |
| `PositionUnchanged` | `CONFLICT` | `tile` |
| `ShareGrantExpired` | `GONE` | — |
| `NotShared` | `NOT_FOUND` | — |

### Dashboarding — `MonitorError`

| `kind` | Code | `data` |
|---|---|---|
| `NameRequired` | `BAD_REQUEST` | — |
| `NegativeCooldown` | `BAD_REQUEST` | — |
| `AnalysisMustBeScalar` | `UNPROCESSABLE_CONTENT` | — |
| `InvalidAnalysis` | `UNPROCESSABLE_CONTENT` | `detail` |
| `AlreadyEnabled` | `CONFLICT` | — |
| `AlreadyDisabled` | `CONFLICT` | — |

### Analytics — `AnalysisError` and `EngineFailure`

| `kind` | Code | `data` |
|---|---|---|
| `InvalidAnalysis` | `UNPROCESSABLE_CONTENT` | `detail` |
| `WindowTooLarge` | `UNPROCESSABLE_CONTENT` | `max` |
| `UnknownDimension` | `UNPROCESSABLE_CONTENT` | `dimension` |
| `UnknownMeasure` | `UNPROCESSABLE_CONTENT` | `measure` |
| `Timeout` | `GATEWAY_TIMEOUT` | `budgetMs` |
| `Unavailable` | `SERVICE_UNAVAILABLE` | `detail` |
| `InvalidQuery` | `UNPROCESSABLE_CONTENT` | `detail` |
| `NotImplemented` | `NOT_IMPLEMENTED` | `feature` (`"retention" \| "group_by" \| "nested_predicates"`) |

`Timeout` maps to 504 and not 408: the caller's request was fine, the upstream engine did not
answer in time. 408 would tell the client *it* was slow, which is a different instruction.

### Ingestion — `AdmissionError`

| `kind` | Code | `data` |
|---|---|---|
| `MalformedEvent` | `BAD_REQUEST` | `index`, `detail` |
| `BatchTooLarge` | `PAYLOAD_TOO_LARGE` | `count`, `max` |
| `PayloadTooLarge` | `PAYLOAD_TOO_LARGE` | `bytes`, `max` |
| `UnknownEventName` | `UNPROCESSABLE_CONTENT` | `name` |
| `ClockSkew` | `UNPROCESSABLE_CONTENT` | `skewMs`, `max` |
| `PersonIdRequired` | `BAD_REQUEST` | — |
| `PersonIdTooLong` | `BAD_REQUEST` | `length`, `max` |
| `PersonIdLooksLikeEmail` | `UNPROCESSABLE_CONTENT` | — |
| `PlanExceeded` | `PAYMENT_REQUIRED` | `limit`, `used` |
| `RateLimited` | `TOO_MANY_REQUESTS` | `retryAfterMs` |
| `SinkUnavailable` | `SERVICE_UNAVAILABLE` | `detail` |

`PlanExceeded` is 402 and `RateLimited` is 429, and the difference is the instruction: upgrade
versus back off. Conflating them is a support ticket.

### Identity and authorization

| `kind` | Code | `data` |
|---|---|---|
| `NotAuthenticated` | `UNAUTHORIZED` | — |
| `NotPermitted` | `FORBIDDEN` | `required` (a `Permission`) |
| `OutOfBinding` | `FORBIDDEN` | `resource` |
| `NoSuchAccount` | `NOT_FOUND` | `account` |
| `IssuerNotAMember` | `FORBIDDEN` | `account` |
| `NothingGrantable` | `FORBIDDEN` | `account` |
| `InvitationExpired` | `GONE` | — |
| `InvitationAlreadyAccepted` | `CONFLICT` | — |
| `RateLimited` | `TOO_MANY_REQUESTS` | `retryAfterMs` |

`Unknown`, `Revoked` and `Expired` credentials have **no row here on purpose**: they collapse
into `anonymous` before any procedure sees them, and the caller gets `UNAUTHORIZED` with no
detail. Telling an attacker which of their guesses exists is the thing that collapse prevents.

---

## 7. Decisions taken here that you must not re-litigate alone

**The Analysis lives in `@counted/analytics-domain`, and `no-cross-context-domain` forbids
`@counted/dashboarding-domain` importing it.** So `Tile`, `Dashboard` and `Monitor` are generic
in the analysis type — `Tile<A>` — and `A` is closed one layer up, in
`@counted/dashboarding-app`, which may import `@counted/analytics-ports`. Anything that needs
to *inspect* an analysis ("this monitor's analysis must be scalar") belongs in `app` for the
same reason: that is an analytics question, not a dashboard one. If this proves unworkable, the
alternative is to promote the Analysis IR into the kernel as a shared kernel — but that is a
change to the package boundaries and requires updating their dependency rules and consumers.

**Bucket edges are litics', not ours.** litics computes bucket edges from its intervals and
the query `step`. Keeping a second implementation in the domain would allow the two to
disagree. `Duration` has no calendar arithmetic for this reason.

**`Clock` and `IdGenerator` are in `@counted/kernel/ports`, not in a context's ports package.**
Putting `Clock` in one context and having six others import it would make that context look
like a dependency of the whole system.

**The kernel owns `Role` and `Permission`; `@counted/authorization` owns the grant table.**
Forced by `contract-is-a-leaf`: the contract must emit `security` from a permission
declaration, and it may import only `@orpc/*`, `zod` and the kernel.

**Use cases do not import `@counted/authorization`.** The decision runs in `apps/*` before the
use case. A use case that re-checked would be a second policy.

---

## 8. Corrections to the brief, found by running the code

The migration brief's `@orpc/openapi` snippet does not match `2.0.0-beta.32` as installed. Read
out of `node_modules/@orpc/openapi/dist/index.d.ts` and confirmed by generating a document:

```ts
// WRONG (from the brief)
new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] })
await gen.generate(contract, { info: { title: "Counted API", version: "1" } })

// RIGHT (beta.32)
new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] })
await gen.generate(contract, { base: { info: { title: "Counted API", version: "1" } } })
```

`OpenAPIGeneratorOptions` is `{ converters?, serializer? }`. `OpenAPIGeneratorGenerateOptions`
is `{ base?, customComponentName?, filter?, customErrorResponseBodySchema?, errorStatusMap? }`.
`scripts/generate-openapi.ts` uses the corrected form.

Everything else in the brief checked out:

- `oc` exposes exactly `meta`, `errors`, `input`, `output`, `router` (plus `constructor` and
  the internal `~orpc`). No `.route()`, no `.prefix()`, no `.tag()`.
- `ZodToJsonSchemaConverter` is a root export of `@orpc/zod`; there is no `/zod4` subpath.
- The generator emits `"openapi": "3.1.2"`.
- A declared `CONFLICT` with a `data` schema lands at status 409 in the document with the Zod
  object fully expanded.

---

## 9. Conventions

**Comments say why, not what.** `// increment the counter` above `count += 1` is noise. The
comments that earn their place name the failure the code prevents, and most of them name a real
one — v1's `emptyData()` fallback, the three width vocabularies, the `UPDATE … WHERE user_id`
that matched nothing and reported success. If you cannot name what would go wrong without the
line, delete the comment.

**Naming.**

- Files are `kebab-case.ts`; tests sit next to them as `*.test.ts` and run with `bun test`.
- Types and aggregates are `PascalCase`. A type and a companion const object may share a name
  (`Instant` the type, `Instant` the namespace) — that is deliberate and used throughout.
- Errors are discriminated unions with a `kind` field in `PascalCase`: `{ kind: "TooManyTiles";
  max: number }`. Never a string, never an exception, never an error class.
- Events are discriminated unions with a `kind` field and an `at: Instant`, extending
  `DomainEvent`. Envelope `type` strings are `"<context>.<Kind>"`.
- Ports are interfaces named for the capability (`CredentialStore`), not for the technology
  (`BetterAuthKeyStore`). If a port's name mentions a vendor, the abstraction has already
  failed.
- Repository methods: `find` returns `T | null` and never throws for absence; `list*` returns a
  `readonly T[]`; `save` takes the aggregate **and its events**.

**Failure handling.** The domain returns `Result`, never throws, for anything a caller can
cause. Throwing is reserved for programmer error and for rolling back a `UnitOfWork`.

**Tests test behaviour and invariants, not getters.** Prefer a test that states a rule ("a
guard cannot tell one brand from another", "all returns the FIRST error") over one that
re-asserts a field assignment. Co-locate as `*.test.ts`.

**Before you hand off:** `bun run typecheck && bun run arch && bun run test` must all be green,
and if you touched the contract, `bun run openapi:generate` too.
