import { describe, expect, test } from "bun:test";
import { Instant, ProjectId, WorkspaceId } from "@counted/kernel";

import { postgresRecentProjects, type ProjectQueryable } from "./recent-projects";
import { T0 } from "../testing";

const recording = (rows: Record<string, unknown>[]) => {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db: ProjectQueryable = {
    async query<R extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      calls.push({ sql, values: values ?? [] });
      return { rows: rows as R[] };
    },
  };
  return { db, calls };
};

describe("postgresRecentProjects", () => {
  test("asks only for claimed, unarchived projects inside the window", async () => {
    // Every one of those three conditions is load-bearing. An unclaimed
    // project's key belongs to the holding workspace and this reader does not
    // know which one that is; an archived project accepts no events, so a key
    // would be issued for nothing; and an unbounded scan would make the job's
    // cost grow with the installation forever for a defect whose rate does not.
    const { db, calls } = recording([]);
    await postgresRecentProjects(db).createdSince(T0, 25);

    const sql = calls[0]?.sql ?? "";
    expect(sql).toContain("workspace_id IS NOT NULL");
    expect(sql).toContain("archived = false");
    expect(sql).toContain("created_at >= $1");
    expect(calls[0]?.values).toEqual([Instant.toDate(T0), 25]);
  });

  test("a row becomes a record with branded ids", async () => {
    const created = new Date("2026-01-01T00:00:00.000Z");
    const { db } = recording([
      { id: "prj_1", workspace_id: "ws_1", name: "Acme web", created_at: created },
    ]);

    const [record] = await postgresRecentProjects(db).createdSince(T0, 25);

    expect(record?.project).toBe(ProjectId("prj_1"));
    expect(record?.workspace).toBe(WorkspaceId("ws_1"));
    expect(record?.name).toBe("Acme web");
    expect(record?.createdAt).toEqual(Instant.fromDate(created));
  });
});
