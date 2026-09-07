/**
 * Schema drift detection. The config generates the DDL, but nothing stops a
 * config from being edited AFTER its migrations ran — the migrator won't
 * re-run executed steps, and the builders would happily emit SQL against
 * columns that don't exist. expectedSchema()/diffSchema() compare the
 * config's intent against what information_schema actually reports;
 * adapters run the introspection query and call diffSchema at startup.
 */

import type { ResolvedConfig } from "./config.js";

export interface ColumnSpec {
  /** Table name, unqualified (the introspection query is schema-scoped). */
  table: string;
  column: string;
  /** Postgres internal type name as information_schema reports it (udt_name). */
  udt: string;
}

export function expectedSchema(cfg: ResolvedConfig): ColumnSpec[] {
  const cols: ColumnSpec[] = [];
  const add = (table: string, column: string, udt: string) => cols.push({ table, column, udt });

  add("dims", "dim", "text");
  add("dims", "value", "text");
  add("dims", "id", "int4");
  if (cfg.tenancy?.hierarchy) {
    add("org_tree", "ancestor", cfg.tenancy.type);
    add("org_tree", "descendant", cfg.tenancy.type);
    add("org_tree", "depth", "int4");
  }

  for (const st of cfg.streams) {
    add(st.name, "ts", "timestamptz");
    add(st.name, "staged_at", "timestamptz");
    add(st.name, "event_id", "uuid");
    add(st.name, "actor_id", st.actorType);
    if (cfg.tenancy) add(st.name, "tenant_id", cfg.tenancy.type);
    add(st.name, "session_id", "int8");
    add(st.name, "event_type", "int4");
    for (const d of st.dimensions) add(st.name, d.name, d.type);
    for (const m of st.measures) add(st.name, m.name, m.type);
    add(st.name, "props", "jsonb");

    const segments = `${st.name}_segments`;
    add(segments, "segment_id", "int8");
    if (cfg.tenancy) add(segments, "tenant_id", cfg.tenancy.type);
    add(segments, "ts_min", "timestamptz");
    add(segments, "ts_max", "timestamptz");
    add(segments, "n", "int4");
    add(segments, "format", "int2");
    add(segments, "series", "text");
    add(segments, "raw_bytes", "jsonb");
    add(segments, "created_at", "timestamptz");
    const packed = ["ts", "actor", "session_id", "event_type", ...st.dimensions.map((d) => d.name), ...st.measures.map((m) => m.name), "props", "extra"];
    for (const c of packed) add(segments, c, "bytea");
    add(segments, "extra_meta", "jsonb");

    const summary = `${st.name}_summary`;
    add(summary, "segment_id", "int8");
    if (cfg.tenancy) add(summary, "tenant_id", cfg.tenancy.type);
    add(summary, "bucket", "timestamptz");
    add(summary, "event_type", "int4");
    add(summary, "n", "int8");
    for (const m of st.measures) add(summary, m.name, m.type);
    // Array columns report as _<element> in information_schema.udt_name.
    add(summary, "actors", "_int8");

    const summaryDims = `${st.name}_summary_dims`;
    add(summaryDims, "segment_id", "int8");
    if (cfg.tenancy) add(summaryDims, "tenant_id", cfg.tenancy.type);
    add(summaryDims, "bucket", "timestamptz");
    add(summaryDims, "event_type", "int4");
    add(summaryDims, "dim", "int2");
    add(summaryDims, "value", "int4");
    add(summaryDims, "n", "int8");
    for (const m of st.measures) add(summaryDims, m.name, m.type);
    add(summaryDims, "actors", "_int8");
  }
  return cols;
}

/**
 * Compare the config's expected schema against introspected columns.
 * `actual` is every column in the litics schema (unknown tables are
 * ignored — only expected tables are checked). Returns human-readable
 * issues; empty array = no drift.
 */
export function diffSchema(cfg: ResolvedConfig, actual: ColumnSpec[]): string[] {
  const issues: string[] = [];

  const actualByTable = new Map<string, Map<string, string>>();
  for (const a of actual) {
    let table = actualByTable.get(a.table);
    if (!table) actualByTable.set(a.table, (table = new Map()));
    table.set(a.column, a.udt);
  }

  const expectedByTable = new Map<string, Map<string, string>>();
  for (const e of expectedSchema(cfg)) {
    let table = expectedByTable.get(e.table);
    if (!table) expectedByTable.set(e.table, (table = new Map()));
    table.set(e.column, e.udt);
  }

  for (const [table, expected] of expectedByTable) {
    const qualified = `${cfg.schema}.${table}`;
    const got = actualByTable.get(table);
    if (!got) {
      issues.push(`missing table ${qualified} — have migrations for this config been run?`);
      continue;
    }
    for (const [column, udt] of expected) {
      const gotUdt = got.get(column);
      if (gotUdt === undefined) {
        issues.push(`${qualified} is missing column "${column}" (${udt}) — was it added to the config after migrations ran?`);
      } else if (gotUdt !== udt) {
        issues.push(`${qualified}.${column}: config expects ${udt}, database has ${gotUdt}`);
      }
    }
    for (const column of got.keys()) {
      if (!expected.has(column)) {
        issues.push(`${qualified} has column "${column}" the config doesn't know about — was it removed from the config after migrations ran?`);
      }
    }
  }
  return issues;
}
