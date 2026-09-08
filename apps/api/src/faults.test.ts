/**
 * The domain-error mapping, checked against the artifact rather than against
 * itself.
 *
 * Two properties, and only the second is interesting.
 *
 * **Every mapping is exhaustive.** The `assertNever` at the bottom of each
 * `map*` already makes that a compile-time fact; the tests below exist to pin
 * the *choices* — that a payment failure is 402 and a rate limit is 429, that a
 * timeout is 504 and not 408.
 *
 * **Every reason the server can emit is either declared by the contract or on
 * a list.** A reason the contract does not declare still reaches the client at
 * the right status, but oRPC marks it `defined: false` and a generated client
 * cannot narrow it — so it degrades from a typed error to an unknown one. The
 * list is read out of `openapi.json`, which is the artifact clients are built
 * from, so this test fails in both useful directions: when a new undeclared
 * reason appears, and when a listed one is finally declared and the list should
 * shrink.
 */

import { describe, expect, test } from "bun:test";
import { Duration, Instant } from "@counted/kernel";
import {
  UNDECLARED_REASONS,
  fromBatchAdmissionError,
  fromBillingError,
  fromDashboardError,
  fromDenial,
  fromEngineFailure,
  fromMonitorError,
  fromProjectError,
  fromVerificationFailure,
  fromWorkspaceError,
  notImplemented,
  type Fault,
} from "./faults";
import document from "../../../openapi.json" with { type: "json" };

/** Every `(code, reason)` pair the generated document declares. */
const declared = (): ReadonlySet<string> => {
  const pairs = new Set<string>();
  const reasonsIn = (schema: unknown, into: Set<string>): void => {
    if (schema === null || typeof schema !== "object") return;
    const node = schema as Record<string, unknown>;
    const properties = node.properties as Record<string, { const?: unknown }> | undefined;
    const reason = properties?.reason?.const;
    if (typeof reason === "string") into.add(reason);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((item) => reasonsIn(item, into));
      else reasonsIn(value, into);
    }
  };

  for (const schema of Object.values(document.components.schemas)) {
    const node = schema as { properties?: { code?: { const?: string }; data?: unknown } };
    const code = node.properties?.code?.const;
    if (typeof code !== "string") continue;
    const reasons = new Set<string>();
    reasonsIn(node.properties?.data, reasons);
    for (const reason of reasons) pairs.add(`${code}:${reason}`);
  }
  return pairs;
};

/** Every fault the mapper can produce, one per domain error kind. */
const everyFault = (): readonly Fault[] => [
  fromDenial({ reason: "NotAuthenticated" }),
  fromDenial({ reason: "NotAMember", account: "a" as never }),
  fromDenial({ reason: "NotPermitted", required: "projects:read" }),
  fromDenial({
    reason: "OutOfBinding",
    required: "projects:read",
    resource: { type: "project", id: "p" as never },
    gap: "DifferentProject",
  }),
  fromVerificationFailure({ kind: "Unknown" }),
  fromVerificationFailure({ kind: "RateLimited", retryAfter: Duration.seconds(30) }),

  fromWorkspaceError({ kind: "NameRequired" }),
  fromWorkspaceError({ kind: "NoSuchWorkspace", workspace: "w" as never }),
  fromWorkspaceError({ kind: "AlreadyAMember", account: "a" as never }),
  fromWorkspaceError({ kind: "NotAMember", account: "a" as never }),
  fromWorkspaceError({ kind: "RoleUnchanged", account: "a" as never, role: "admin" }),
  fromWorkspaceError({ kind: "LastOwner", account: "a" as never }),
  fromWorkspaceError({ kind: "SeatLimitReached", limit: 3 }),
  fromWorkspaceError({ kind: "ProjectExists", project: "p" as never }),
  fromWorkspaceError({ kind: "NoSuchProject", project: "p" as never }),
  fromWorkspaceError({ kind: "ProjectAlreadyArchived", project: "p" as never }),
  fromWorkspaceError({ kind: "ProjectNotArchived", project: "p" as never }),
  fromWorkspaceError({ kind: "ProjectLimitReached", limit: 3 }),

  fromBillingError({ kind: "NoSubscription", workspace: "w" as never }),
  fromBillingError({ kind: "PlanUnavailable", plan: "gold" }),
  fromBillingError({ kind: "BadSignature" }),
  fromBillingError({ kind: "Stale", ageSeconds: 900 }),
  fromBillingError({ kind: "Malformed", detail: "no id" }),
  fromBillingError({ kind: "ProviderUnavailable", detail: "502" }),

  fromProjectError({ kind: "NameRequired" }),
  fromProjectError({ kind: "NameUnchanged" }),
  fromProjectError({ kind: "NoSuchProject", project: "p" as never }),
  fromProjectError({ kind: "FirstCredentialMustIngest" }),
  fromProjectError({ kind: "PermissionsRequired" }),
  fromProjectError({ kind: "PermissionEscalation", requested: [], held: [] }),
  fromProjectError({ kind: "CredentialExists", credential: "c" as never }),
  fromProjectError({ kind: "UnknownCredential", credential: "c" as never }),
  fromProjectError({ kind: "CredentialRevoked", credential: "c" as never }),
  fromProjectError({ kind: "CredentialExpired", credential: "c" as never }),
  fromProjectError({ kind: "LastIngestCredential", credential: "c" as never }),
  fromProjectError({ kind: "RotationKindMismatch" }),
  fromProjectError({ kind: "AlreadyClaimed" }),
  fromProjectError({ kind: "GrantExpired" }),
  fromProjectError({ kind: "GrantMismatch" }),
  fromProjectError({ kind: "ProjectArchived", project: "p" as never }),
  fromProjectError({ kind: "ProjectNotArchived", project: "p" as never }),
  fromProjectError({ kind: "InvalidRetention", days: -1 }),
  fromProjectError({ kind: "RetentionUnchanged" }),

  fromDashboardError({ kind: "NameRequired" }),
  fromDashboardError({ kind: "NameUnchanged" }),
  fromDashboardError({ kind: "NoSuchDashboard", dashboard: "d" as never }),
  fromDashboardError({ kind: "TileTitleRequired" }),
  fromDashboardError({ kind: "TileExists", tile: "t" as never }),
  fromDashboardError({ kind: "NoSuchTile", tile: "t" as never }),
  fromDashboardError({ kind: "TooManyTiles", max: 50 }),
  fromDashboardError({ kind: "InvalidWidth", width: 13 }),
  fromDashboardError({ kind: "WidthUnchanged", tile: "t" as never }),
  fromDashboardError({ kind: "IndexOutOfRange", index: 9, size: 2 }),
  fromDashboardError({ kind: "PositionUnchanged", tile: "t" as never }),
  fromDashboardError({ kind: "NotAPermutation", expected: 3, received: 2 }),
  fromDashboardError({ kind: "OrderUnchanged" }),
  fromDashboardError({ kind: "DefaultUnchanged" }),
  fromDashboardError({ kind: "ShareGrantExpired" }),
  fromDashboardError({ kind: "ShareGrantMismatch" }),
  fromDashboardError({ kind: "NotShared" }),

  fromMonitorError({ kind: "NameRequired" }),
  fromMonitorError({ kind: "NameUnchanged" }),
  fromMonitorError({ kind: "NoSuchMonitor", monitor: "m" as never }),
  fromMonitorError({ kind: "NegativeCooldown" }),
  fromMonitorError({ kind: "AnalysisMustBeScalar" }),
  fromMonitorError({ kind: "InvalidAnalysis", detail: "bad" }),
  fromMonitorError({ kind: "AlreadyEnabled" }),
  fromMonitorError({ kind: "AlreadyDisabled" }),

  fromEngineFailure({ kind: "Timeout", budget: Duration.seconds(10) }),
  fromEngineFailure({ kind: "Unavailable", detail: "down" }),
  fromEngineFailure({ kind: "InvalidQuery", detail: "no" }),
  fromEngineFailure({ kind: "NotImplemented", feature: "retention" }),

  fromBatchAdmissionError({ kind: "BatchTooLarge", count: 9, max: 5 }),
  fromBatchAdmissionError({ kind: "PayloadTooLarge", bytes: 9, max: 5 }),
  fromBatchAdmissionError({ kind: "PlanExceeded", limit: 5, used: 9 }),
  fromBatchAdmissionError({ kind: "RateLimited", retryAfterMs: 1000 }),
  fromBatchAdmissionError({ kind: "SinkUnavailable", detail: "down" }),
];

describe("the domain-error mapping", () => {
  test("every reason is either declared by the contract or on the list", () => {
    const known = declared();
    const undeclared = everyFault()
      .filter((fault) => !known.has(`${fault.code}:${String(fault.data.reason)}`))
      .map((fault) => String(fault.data.reason));

    expect([...new Set(undeclared)].sort()).toEqual([...UNDECLARED_REASONS].sort());
  });

  /**
   * The list has to shrink when the contract is widened. Without this, a
   * declared reason could sit on it forever and the list would stop meaning
   * "these are the gaps".
   */
  test("nothing on the undeclared list is actually declared at the code it maps to", () => {
    const known = declared();
    const stale = everyFault()
      .filter(
        (fault) =>
          UNDECLARED_REASONS.includes(String(fault.data.reason)) &&
          known.has(`${fault.code}:${String(fault.data.reason)}`),
      )
      .map((fault) => `${fault.code}:${String(fault.data.reason)}`);
    expect(stale).toEqual([]);
  });

  test("a payment failure and a rate limit are different instructions", () => {
    expect(fromBatchAdmissionError({ kind: "PlanExceeded", limit: 5, used: 9 }).code).toBe(
      "PAYMENT_REQUIRED",
    );
    expect(fromBatchAdmissionError({ kind: "RateLimited", retryAfterMs: 1 }).code).toBe(
      "TOO_MANY_REQUESTS",
    );
  });

  test("an engine timeout is 504, not 408 — the caller was not the slow one", () => {
    expect(fromEngineFailure({ kind: "Timeout", budget: Duration.seconds(1) }).code).toBe(
      "GATEWAY_TIMEOUT",
    );
  });

  /**
   * The three credential failures collapse to one bare 401. A distinct message
   * or status for each tells whoever is guessing which of their guesses exists.
   */
  test("unknown, revoked and expired credentials are indistinguishable", () => {
    const answers = [
      fromVerificationFailure({ kind: "Unknown" }),
      fromVerificationFailure({ kind: "Revoked", at: Instant.EPOCH }),
      fromVerificationFailure({ kind: "Expired", at: Instant.EPOCH }),
    ].map((fault) => JSON.stringify(fault));
    expect(new Set(answers).size).toBe(1);
    expect(JSON.parse(answers[0] as string).code).toBe("UNAUTHORIZED");
  });

  /**
   * "You are not a member of workspace X" would confirm X exists to somebody
   * who guessed the id, so it goes out as the same 403 any other refusal does.
   */
  test("not-a-member is not distinguishable from not-permitted on the wire", () => {
    const notAMember = fromDenial({ reason: "NotAMember", account: "a" as never });
    expect(notAMember.code).toBe("FORBIDDEN");
    expect(notAMember.data.reason).toBe("NotPermitted");
    // The account is named in the denial for the log and must not reach the
    // wire: naming it confirms the workspace exists to somebody who guessed.
    expect(JSON.stringify(notAMember)).not.toContain("\"a\"");
  });

  /**
   * `orCredentialFault` picks its mapper by kind, which is only safe while the
   * two unions have no kind in common.
   */
  /**
   * The one reason whose *code* is declared and whose *payload* is not.
   *
   * `QUERY_ERRORS` declares 501 with `feature` as an analytics enum. The
   * membership-write 501 carries a value outside it, so a generated client sees
   * a 501 it cannot narrow. Pinned here rather than hidden in the list above,
   * because the fix is different: this one needs a widened enum, not a new map.
   */
  test("the membership-write 501 carries a feature the contract's enum lacks", () => {
    const fault = notImplemented("membership_writes", "no port");
    expect(fault.code).toBe("NOT_IMPLEMENTED");

    const analytics = JSON.stringify(document.components.schemas);
    expect(analytics).toContain('"retention"');
    expect(analytics).not.toContain("membership_writes");
  });

  test("IssueFailure and ProjectError share no kind", () => {
    const issue = ["NoSuchWorkspace", "NoSuchProject", "IssuerNotAMember", "NothingGrantable"];
    const project = [
      "NameRequired", "NameUnchanged", "NoSuchProject", "FirstCredentialMustIngest",
      "PermissionsRequired", "PermissionEscalation", "CredentialExists", "UnknownCredential",
      "CredentialRevoked", "CredentialExpired", "LastIngestCredential", "RotationKindMismatch",
      "AlreadyClaimed", "GrantExpired", "GrantMismatch", "ProjectArchived", "ProjectNotArchived",
      "InvalidRetention", "RetentionUnchanged",
    ];
    // `NoSuchProject` is the one overlap, and both map to the same 404 with the
    // same `project` field — so picking the wrong mapper for it is harmless.
    const overlap = issue.filter((kind) => project.includes(kind));
    expect(overlap).toEqual(["NoSuchProject"]);
  });
});
