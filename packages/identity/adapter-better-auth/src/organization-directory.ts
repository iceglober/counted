import { AccountId, Instant, WorkspaceId, unbrand } from "@counted/kernel";
import type { OrganizationDirectory, OrganizationRecord } from "@counted/identity-ports";
import type { IdentityAuth } from "./auth";
import { instantOf } from "./rows";

export const betterAuthOrganizationDirectory = (identity: IdentityAuth, holding: WorkspaceId): OrganizationDirectory => ({
  async page({ since, cursor, limit }) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) throw new RangeError("Organization page size must be between 1 and 10000.");
    let records: OrganizationRecord[];
    if (identity.database.kind === "postgres") {
      const result = await identity.database.pool.query<{ id: string; name: string; createdAt: Date; owner: string | null }>(`
        SELECT o.id, o.name, o."createdAt", (
          SELECT m."userId" FROM "member" m JOIN "user" u ON u.id = m."userId"
          WHERE m."organizationId" = o.id AND m.role = 'owner'
          ORDER BY m."createdAt", m."userId" LIMIT 1
        ) AS owner FROM "organization" o
        WHERE o."createdAt" >= $1 AND o.id <> $2
          AND ($3::timestamptz IS NULL OR (o."createdAt", o.id) > ($3::timestamptz, $4::text))
        ORDER BY o."createdAt", o.id LIMIT $5
      `, [Instant.toDate(since), unbrand(holding), cursor ? Instant.toDate(cursor.createdAt) : null, cursor ? unbrand(cursor.workspace) : null, limit + 1]);
      records = result.rows.map((row) => ({ workspace: WorkspaceId(row.id), name: row.name, createdAt: Instant.fromDate(row.createdAt), owner: row.owner === null ? null : AccountId(row.owner) }));
    } else {
      const adapter = (await identity.auth.$context).adapter;
      const rows = await adapter.findMany<{ id: string; name: string; createdAt: Date }>({ model: "organization", limit: Number.MAX_SAFE_INTEGER });
      const sorted = rows.filter((row) => row.id !== holding && (instantOf(row.createdAt) ?? Instant.EPOCH) >= since)
        .map((row) => ({ ...row, instant: instantOf(row.createdAt) ?? Instant.EPOCH }))
        .filter((row) => cursor === null || row.instant > cursor.createdAt || (row.instant === cursor.createdAt && row.id > cursor.workspace))
        .sort((a, b) => a.instant - b.instant || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, limit + 1);
      records = await Promise.all(sorted.map(async (row) => {
        const owners = await adapter.findMany<{ userId: string; createdAt: Date }>({ model: "member", where: [{ field: "organizationId", value: row.id }, { field: "role", value: "owner" }], limit: Number.MAX_SAFE_INTEGER });
        owners.sort((a, b) => (instantOf(a.createdAt) ?? Instant.EPOCH) - (instantOf(b.createdAt) ?? Instant.EPOCH) || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
        let owner = null;
        for (const candidate of owners) {
          if (await adapter.findOne({ model: "user", where: [{ field: "id", value: candidate.userId }] })) { owner = AccountId(candidate.userId); break; }
        }
        return { workspace: WorkspaceId(row.id), name: row.name, createdAt: row.instant, owner };
      }));
    }
    const items = records.slice(0, limit);
    const last = items.at(-1);
    return { items, cursor: records.length > limit && last ? { createdAt: last.createdAt, workspace: last.workspace } : null };
  },
});
