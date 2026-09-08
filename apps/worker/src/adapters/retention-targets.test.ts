import { describe, expect, test } from "bun:test";

import { ProjectId } from "@counted/kernel";

import { postgresRetentionTargets, type RetentionQueryable } from "./retention-targets";

type Row = Record<string, unknown>;

const db = (
  rows: readonly Row[],
): RetentionQueryable & { readonly calls: { sql: string; values: unknown[] }[] } => {
  const calls: { sql: string; values: unknown[] }[] = [];
  return {
    calls,
    query: async <R extends Row>(sql: string, values?: unknown[]) => {
      calls.push({ sql, values: values ?? [] });
      return { rows: rows as R[] };
    },
  };
};

const row = (overrides: Partial<Row> = {}): Row => ({
  id: "pr_1",
  workspace_id: "ws_1",
  retention_days: null,
  plan: "free",
  payment_state: "active",
  ...overrides,
});

describe("enumerating retention targets", () => {
  test("a null retention column means the project inherits its plan", async () => {
    const page = await postgresRetentionTargets(db([row()])).page(null, 10);

    expect(page.targets).toEqual([
      {
        project: ProjectId("pr_1"),
        workspace: expect.anything(),
        plan: "free",
        payment: "active",
        policy: { kind: "inherit" },
      },
    ]);
  });

  test("the walk resumes after the last id, not after an offset", async () => {
    const store = db([row({ id: "pr_1" }), row({ id: "pr_2" })]);
    await postgresRetentionTargets(store).page(ProjectId("pr_0"), 2);

    expect(store.calls[0]?.values).toEqual(["pr_0", 2]);
    expect(store.calls[0]?.sql).toContain("ORDER BY p.id");
    expect(store.calls[0]?.sql).not.toContain("OFFSET");
  });

  /**
   * A plan name we do not recognise must not fall back to free: free has the
   * shortest retention in the catalogue, so the fallback would delete a paying
   * customer's data because of a typo in an enum.
   */
  test("a row with an unrecognised plan is skipped, never defaulted", async () => {
    const page = await postgresRetentionTargets(
      db([row({ plan: "enterprise" }), row({ id: "pr_2", payment_state: "trialing" })]),
    ).page(null, 10);

    expect(page.targets).toEqual([]);
    expect(page.examined).toBe(2);
  });

  test("a retention column the domain refuses is skipped, not clamped", async () => {
    const page = await postgresRetentionTargets(db([row({ retention_days: 0 })])).page(null, 10);
    expect(page.targets).toEqual([]);
  });

  /**
   * The cursor comes off the raw rows. Taking it from the last *readable*
   * target would re-read the unreadable one forever; deciding exhaustion from
   * the readable count would end the sweep at the first bad row.
   */
  test("the cursor is the last row returned, readable or not", async () => {
    const page = await postgresRetentionTargets(
      db([row({ id: "pr_1" }), row({ id: "pr_2", plan: "enterprise" })]),
    ).page(null, 2);

    expect(page.targets).toHaveLength(1);
    expect(page.cursor).toEqual(ProjectId("pr_2"));
  });

  test("a short page ends the walk", async () => {
    const page = await postgresRetentionTargets(db([row()])).page(null, 10);
    expect(page.cursor).toBeNull();
  });

  test("an unclaimed project never appears, because it has no plan to enforce", async () => {
    const store = db([]);
    await postgresRetentionTargets(store).page(null, 10);
    // The join to `workspaces` is what excludes it: an unclaimed project has a
    // null workspace_id by the ownership constraint in schema.ts.
    expect(store.calls[0]?.sql).toContain("JOIN workspaces w ON w.id = p.workspace_id");
  });
});
