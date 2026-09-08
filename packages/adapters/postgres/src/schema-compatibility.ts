import type { Queryable } from "./queryable";

/** Boot DDL supports fresh and v3 databases, not the older storage model. */
export class LegacySchemaNotSupported extends Error {
  constructor(readonly markers: readonly string[]) {
    super(
      `This database uses the legacy Counted schema (${markers.join(", ")}). ` +
      "Automatic startup migrations do not support this schema. " +
      "Start this version against a fresh, separate database; retain the previous database, deployment, " +
      "and verified backups for recovery. No legacy data is imported and no startup schema changes were applied.",
    );
    this.name = "LegacySchemaNotSupported";
  }
}

/**
 * IF NOT EXISTS cannot turn v2 UUID ownership keys into v3 text keys or move
 * embedded dashboard content into Insight rows. Detect those signatures while
 * holding the schema lock, before even creating a namespace. Checking metadata
 * keeps this independent of customer rows and of the old migration ledger.
 */
export const assertCompatibleSchema = async (db: Queryable): Promise<void> => {
  const { rows } = await db.query<{ marker: string }>(
    `SELECT table_name || '.' || column_name || ' (' || udt_name || ')' AS marker
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name IN ('workspaces', 'projects', 'dashboards')
              AND column_name = 'id' AND udt_name = 'uuid')
          OR (table_name = 'dashboards' AND column_name = 'tiles'))
      ORDER BY table_name, column_name`,
  );
  if (rows.length > 0) throw new LegacySchemaNotSupported(rows.map(row => row.marker));
};
