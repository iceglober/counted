/**
 * DDL generator: turns a ResolvedConfig into ordered migration steps.
 *
 * Three layers per stream — staging (the hot table events are written to),
 * segments (the immutable columnar tier the compactor packs staging into)
 * and summaries (per-segment, per-hour rollups) — plus shared
 * infrastructure created once: the dims dictionary, the KMV aggregate, and
 * tenancy's reader role and closure table.
 *
 * Nothing here needs an extension. `select count(*) from pg_extension`
 * returning one row (plpgsql) on the target database is the product claim,
 * and a test asserts no statement below mentions one.
 *
 * Each step is an array of single statements (no client-side splitting of
 * plpgsql bodies needed; multi-statement strings break parameterized
 * execution paths in some drivers).
 */

import { KMV_K } from "./codec/kmv.js";
import type { ResolvedConfig, ResolvedSource, ResolvedStream } from "./config.js";

/** The NOTIFY channel the staging trigger fires on; the compactor listens here. */
export const PACK_CHANNEL = "litics_pack";

/** Postgres column type for a measure. */
function measurePg(t: "int8" | "float8"): string {
  return t === "int8" ? "bigint" : "double precision";
}

/** Postgres column type for tenant ids. */
function tenantPg(t: "uuid" | "text" | "int8"): string {
  return t === "int8" ? "bigint" : t;
}

/** Postgres column type for the actor id. */
function actorPg(t: "int8" | "uuid" | "text"): string {
  return t === "int8" ? "bigint" : t;
}

/* Source tables/columns come from the adopter's schema, which may use
 * camelCase (quoted) identifiers — always quote them. litics' own
 * lowercase identifiers are unaffected by quoting. */
function qid(name: string): string {
  return `"${name}"`;
}

function qtable(name: string): string {
  return name.split(".").map(qid).join(".");
}

export interface MigrationStep {
  /** Stable, ordered name — feeds migration frameworks directly. */
  name: string;
  statements: string[];
}

export function generateMigrations(cfg: ResolvedConfig): MigrationStep[] {
  const steps: MigrationStep[] = [];
  let stepNo = 1;
  const pad = (n: number) => String(n).padStart(4, "0");

  steps.push({ name: `${pad(stepNo++)}_litics_init`, statements: init(cfg) });
  for (const stream of cfg.streams) {
    steps.push({ name: `${pad(stepNo++)}_litics_${stream.name}_staging`, statements: staging(cfg, stream) });
    steps.push({ name: `${pad(stepNo++)}_litics_${stream.name}_segments`, statements: segmentObjects(cfg, stream) });
  }
  return steps;
}

/**
 * Row-level security for the litics_reader role: a session sets
 * `litics.scope` and sees only that tenant — or, with a hierarchy, that
 * tenant's whole subtree. Table owners (ingest, the compactor) are exempt.
 * The engine ALSO injects the same predicate into its queries, so
 * isolation holds even on owner connections; RLS is defense-in-depth.
 */
function rlsStatements(cfg: ResolvedConfig, table: string): string[] {
  if (!cfg.tenancy) return [];
  const { schema: s } = cfg;
  const t = tenantPg(cfg.tenancy.type);
  const using = cfg.tenancy.hierarchy
    ? `EXISTS (SELECT 1 FROM ${s}.org_tree o
                WHERE o.descendant = tenant_id
                  AND o.ancestor = current_setting('litics.scope', true)::${t})`
    : `tenant_id = current_setting('litics.scope', true)::${t}`;
  return [
    `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
    `CREATE POLICY litics_tenant_read ON ${table}
       FOR SELECT TO litics_reader USING (${using})`,
  ];
}

function init(cfg: ResolvedConfig): string[] {
  const { schema: s } = cfg;
  return [
    `CREATE SCHEMA IF NOT EXISTS ${s}`,
    // Shared dictionary. Keyed by dimension name, so same-named dimensions in
    // different streams share an encoding; event types are namespaced as
    // '<stream>.event_type'. Ids start at 1: 0 is the null sentinel in
    // segments and summaries.
    `CREATE TABLE ${s}.dims (
    dim   text NOT NULL,
    value text NOT NULL,
    id    int  GENERATED ALWAYS AS IDENTITY,
    PRIMARY KEY (dim, value),
    UNIQUE (dim, id)
)`,
    ...(cfg.tenancy ? tenancyInit(cfg) : []),
    // KMV sketch union. A sketch is the k smallest 64-bit actor hashes,
    // sorted ascending; the union of two is the k smallest of both. Plain
    // SQL over int8[] — this is what replaces the hll extension. k is fixed
    // here and in the codec; the two must agree, and a change is a segment
    // format bump.
    `CREATE OR REPLACE FUNCTION ${s}.kmv_merge(state int8[], next int8[])
RETURNS int8[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $litics$
    SELECT coalesce(array_agg(h ORDER BY h), '{}'::int8[])
      FROM (SELECT DISTINCT h FROM unnest(state || next) AS u(h) ORDER BY h LIMIT ${KMV_K}) k
$litics$`,
    `CREATE OR REPLACE AGGREGATE ${s}.kmv_union(int8[])
    (SFUNC = ${s}.kmv_merge, STYPE = int8[], INITCOND = '{}', PARALLEL = SAFE)`,
    // Dictionary resolve-or-create. Fast path is one index lookup; the
    // insert branch runs once per new value ever.
    `CREATE OR REPLACE FUNCTION ${s}.ensure_dim(p_dim text, p_value text)
RETURNS int LANGUAGE plpgsql AS $litics$
DECLARE
    v_id int;
BEGIN
    SELECT id INTO v_id FROM ${s}.dims WHERE dim = p_dim AND value = p_value;
    IF v_id IS NULL THEN
        INSERT INTO ${s}.dims (dim, value) VALUES (p_dim, p_value)
        ON CONFLICT (dim, value) DO NOTHING;
        SELECT id INTO v_id FROM ${s}.dims WHERE dim = p_dim AND value = p_value;
    END IF;
    RETURN v_id;
END $litics$`,
    // Segments and summaries are append-and-delete only. Refusing UPDATE is
    // what makes a decoded segment cacheable forever by id.
    `CREATE OR REPLACE FUNCTION ${s}.litics_refuse_update() RETURNS trigger LANGUAGE plpgsql AS $litics$
BEGIN
    RAISE EXCEPTION 'litics: % is immutable; write a new row and delete this one', TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
END $litics$`,
  ];
}

/**
 * Staging: where `track` writes and the compactor reads. Rows live here for
 * minutes — until a pack moves them into a segment — so it is a plain heap
 * with autovacuum turned up: no partitions to create or drop, and a
 * unique index on event_id (idempotentIngest) that means what it says.
 */
function staging(cfg: ResolvedConfig, st: ResolvedStream): string[] {
  const { schema: s } = cfg;
  const table = `${s}.${st.name}`;
  const dimCols = st.dimensions.map((d) => `    ${d.name} ${d.type},`).join("\n");
  const measureCols = st.measures.map((m) => `    ${m.name} ${measurePg(m.type)},\n`).join("");
  const tenantCol = cfg.tenancy ? `    tenant_id   ${tenantPg(cfg.tenancy.type)} NOT NULL,\n` : "";
  const statements = [
    // Fixed 8-byte columns lead, dictionary dims follow, varlena last —
    // alignment-ordered to minimize padding.
    `CREATE TABLE ${table} (
    ts          timestamptz NOT NULL,
    staged_at   timestamptz NOT NULL DEFAULT now(),
    event_id    uuid        NOT NULL,
    actor_id    ${actorPg(st.actorType)} NOT NULL,
${tenantCol}    session_id  bigint,
    event_type  int         NOT NULL,
${dimCols}
${measureCols}    props       jsonb       NOT NULL DEFAULT '{}'
) WITH (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000,
        autovacuum_vacuum_cost_delay = 0, autovacuum_analyze_scale_factor = 0.05)`,
    // The one index the pack step and the tail scan both use: a tenant's
    // rows in time order.
    `CREATE INDEX ${st.name}_ts ON ${table} (${cfg.tenancy ? "tenant_id, " : ""}ts)`,
  ];
  if (st.idempotentIngest) {
    statements.push(`CREATE UNIQUE INDEX ${st.name}_event_id ON ${table} (event_id)`);
  }
  statements.push(
    // Wake the compactor when rows land. Statement-level, so a batch of a
    // thousand is one notification; the payload names the stream.
    `CREATE OR REPLACE FUNCTION ${s}.litics_notify_${st.name}() RETURNS trigger LANGUAGE plpgsql AS $litics$
BEGIN
    PERFORM pg_notify('${PACK_CHANNEL}', '${st.name}');
    RETURN NULL;
END $litics$`,
    `CREATE TRIGGER ${st.name}_notify_pack AFTER INSERT ON ${table}
FOR EACH STATEMENT EXECUTE FUNCTION ${s}.litics_notify_${st.name}()`,
    ...rlsStatements(cfg, table),
  );
  for (const src of st.sources) {
    statements.push(...sourceObjects(cfg, st, src));
  }
  return statements;
}

/**
 * One existing table feeding a stream generates:
 *  - a backfill function: INSERT..SELECT the history into staging, one call
 *    per range; the compactor packs it from there like any other rows
 *  - an AFTER INSERT trigger so new rows become events automatically,
 *    atomically, regardless of which client wrote them.
 */
function sourceObjects(cfg: ResolvedConfig, st: ResolvedStream, src: ResolvedSource): string[] {
  const { schema: s } = cfg;
  const stream = `${s}.${st.name}`;
  const tbl = src.table.replace(".", "_").toLowerCase();

  const eventCols = [
    "ts",
    "event_id",
    "actor_id",
    ...(cfg.tenancy ? ["tenant_id"] : []),
    "event_type",
    ...st.dimensions.map((d) => d.name),
    ...st.measures.map((m) => m.name),
    "props",
  ];
  // Row expressions shared by trigger (ref = NEW) and backfill (ref = t).
  const rowExprs = (ref: string, tsExpr?: string): string[] => [
    tsExpr ?? `coalesce(${ref}.${qid(src.ts)}, now())`,
    `gen_random_uuid()`,
    `${ref}.${qid(src.actor)}`,
    ...(cfg.tenancy ? [`${ref}.${qid(src.tenant!)}`] : []),
    typeof src.eventType === "string"
      ? `${s}.ensure_dim('${st.name}.event_type', '${src.eventType.replace(/'/g, "''")}')`
      : `${s}.ensure_dim('${st.name}.event_type', ${ref}.${qid(src.eventType.column)}::text)`,
    ...st.dimensions.map((d) => {
      const col = src.dims[d.name];
      if (!col) return `NULL::${d.type}`;
      return `CASE WHEN ${ref}.${qid(col)} IS NULL THEN NULL
                   ELSE ${s}.ensure_dim('${d.name}', ${ref}.${qid(col)}::text)::${d.type} END`;
    }),
    ...st.measures.map((m) => {
      const col = src.measures[m.name];
      return col ? `${ref}.${qid(col)}::${measurePg(m.type)}` : `NULL::${measurePg(m.type)}`;
    }),
    src.props.length === 0
      ? `'{}'::jsonb`
      : `jsonb_build_object(${src.props.map((c) => `'${c}', ${ref}.${qid(c)}`).join(", ")})`,
  ];

  const statements = [
    `CREATE OR REPLACE FUNCTION ${s}.backfill_${st.name}_from_${tbl}(p_from timestamptz, p_to timestamptz)
RETURNS bigint LANGUAGE plpgsql AS $litics$
DECLARE
    v_rows bigint;
BEGIN
    INSERT INTO ${stream} (${eventCols.join(", ")})
    SELECT ${rowExprs("t").join(",\n           ")}
      FROM ${qtable(src.table)} t
     WHERE t.${qid(src.ts)} >= p_from AND t.${qid(src.ts)} < p_to;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END $litics$`,
  ];
  if (src.trigger) {
    statements.push(
      `CREATE OR REPLACE FUNCTION ${s}.litics_${st.name}_from_${tbl}()
RETURNS trigger LANGUAGE plpgsql AS $litics$
BEGIN
    INSERT INTO ${stream} (${eventCols.join(", ")})
    VALUES (${rowExprs("NEW").join(",\n            ")});
    RETURN NEW;
END $litics$`,
      `CREATE TRIGGER litics_${st.name} AFTER INSERT ON ${qtable(src.table)}
FOR EACH ROW EXECUTE FUNCTION ${s}.litics_${st.name}_from_${tbl}()`,
    );
    if (src.on === "insert_or_update" && typeof src.eventType === "object") {
      // Mutable-row sources: a status-style column transitions in place, so
      // updates are events too. Stamped now() — the row's own timestamp
      // column doesn't move on update.
      const col = qid(src.eventType.column);
      statements.push(
        `CREATE OR REPLACE FUNCTION ${s}.litics_${st.name}_from_${tbl}_on_update()
RETURNS trigger LANGUAGE plpgsql AS $litics$
BEGIN
    INSERT INTO ${stream} (${eventCols.join(", ")})
    VALUES (${rowExprs("NEW", "now()").join(",\n            ")});
    RETURN NEW;
END $litics$`,
        `CREATE TRIGGER litics_${st.name}_u AFTER UPDATE ON ${qtable(src.table)}
FOR EACH ROW WHEN (OLD.${col} IS DISTINCT FROM NEW.${col})
EXECUTE FUNCTION ${s}.litics_${st.name}_from_${tbl}_on_update()`,
      );
    }
  }
  return statements;
}

/**
 * Segments and their summaries — the immutable columnar tier.
 *
 * A segment is ~segmentRows events packed as one row: the zone map
 * (tenant, ts_min, ts_max, n), a format stamp, and one gzipped bytea per
 * column, encoded by the application. Postgres never opens the byteas; it
 * stores them (EXTERNAL, so TOAST does not re-compress gzip) and returns them
 * whole. Everything that reads a segment does so in the application.
 *
 * The summaries are what make common questions cheap without opening a
 * segment. `_summary` holds one row per (segment, hour, event_type) with the
 * count, the measure sums and a KMV sketch of the actors; `_summary_dims`
 * holds the same cell split by one dimension's value at a time — a marginal
 * per dimension, never the cross product, so rows are bounded by the sum of
 * the dimensions' cardinalities and not by events. A question that names one
 * dimension (filter or group) reads a marginal; one that names two or more
 * decodes the segments instead. The hour column is what lets a segment span
 * days for a quiet tenant and still credit each hour correctly.
 *
 * Both tables are append-and-delete only. A trigger refuses UPDATE, which is
 * what makes a decoded segment cacheable forever by id: nothing with that id
 * can ever mean something else. Merge and retention write new rows and
 * delete old ones; they never edit.
 */
function segmentObjects(cfg: ResolvedConfig, st: ResolvedStream): string[] {
  const { schema: s } = cfg;
  const segments = `${s}.${st.name}_segments`;
  const summary = `${s}.${st.name}_summary`;
  const tenant = cfg.tenancy;
  const tenantCol = tenant ? `    tenant_id   ${tenantPg(tenant.type)} NOT NULL,\n` : "";

  const byteaCols = [
    "ts",
    "actor",
    "session_id",
    "event_type",
    ...st.dimensions.map((d) => d.name),
    ...st.measures.map((m) => m.name),
    "props",
  ];
  const summaryDims = `${s}.${st.name}_summary_dims`;
  const summaryMeasureCols = st.measures.map((m) => `    ${m.name} ${measurePg(m.type)} NOT NULL DEFAULT 0,`).join("\n");

  return [
    `CREATE TABLE ${segments} (
    segment_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
${tenantCol}    ts_min      timestamptz NOT NULL,
    ts_max      timestamptz NOT NULL,
    n           int         NOT NULL CHECK (n > 0),
    format      smallint    NOT NULL,
    series      text        NOT NULL DEFAULT 'recent' CHECK (series IN ('recent', 'late')),
    raw_bytes   jsonb       NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now(),
${byteaCols.map((c) => `    ${c} bytea NOT NULL,`).join("\n")}
    extra       bytea,
    extra_meta  jsonb,
    CHECK (ts_min <= ts_max)
)`,
    // Already gzipped: EXTERNAL keeps TOAST from spending CPU on bytes it
    // cannot shrink further.
    ...byteaCols.map((c) => `ALTER TABLE ${segments} ALTER COLUMN ${c} SET STORAGE EXTERNAL`),
    `ALTER TABLE ${segments} ALTER COLUMN extra SET STORAGE EXTERNAL`,
    // The zone map: every read starts with "which segments overlap [from, to)".
    `CREATE INDEX ${st.name}_segments_zone ON ${segments} (${tenant ? "tenant_id, " : ""}ts_min, ts_max)`,
    `CREATE TRIGGER ${st.name}_segments_immutable BEFORE UPDATE ON ${segments}
FOR EACH ROW EXECUTE FUNCTION ${s}.litics_refuse_update()`,
    `CREATE TABLE ${summary} (
    segment_id  bigint NOT NULL REFERENCES ${segments} (segment_id) ON DELETE CASCADE,
${tenantCol}    bucket      timestamptz NOT NULL,
    event_type  int    NOT NULL,
    n           bigint NOT NULL,
${summaryMeasureCols}
    actors      int8[] NOT NULL,
    PRIMARY KEY (segment_id, bucket, event_type)
)`,
    `CREATE INDEX ${st.name}_summary_bucket ON ${summary} (${tenant ? "tenant_id, " : ""}bucket)`,
    `CREATE TRIGGER ${st.name}_summary_immutable BEFORE UPDATE ON ${summary}
FOR EACH ROW EXECUTE FUNCTION ${s}.litics_refuse_update()`,
    // `dim` is the dimension's position in the stream's declared list; the
    // order of declared dimensions is therefore part of the schema. `value`
    // is the dictionary id, 0 for null, so a breakdown shows the null row.
    `CREATE TABLE ${summaryDims} (
    segment_id  bigint NOT NULL REFERENCES ${segments} (segment_id) ON DELETE CASCADE,
${tenantCol}    bucket      timestamptz NOT NULL,
    event_type  int      NOT NULL,
    dim         smallint NOT NULL,
    value       int      NOT NULL,
    n           bigint   NOT NULL,
${summaryMeasureCols}
    actors      int8[]   NOT NULL,
    PRIMARY KEY (segment_id, bucket, event_type, dim, value)
)`,
    `CREATE INDEX ${st.name}_summary_dims_slice ON ${summaryDims} (${tenant ? "tenant_id, " : ""}dim, value, bucket)`,
    `CREATE TRIGGER ${st.name}_summary_dims_immutable BEFORE UPDATE ON ${summaryDims}
FOR EACH ROW EXECUTE FUNCTION ${s}.litics_refuse_update()`,
    ...rlsStatements(cfg, segments),
    ...rlsStatements(cfg, summary),
    ...rlsStatements(cfg, summaryDims),
  ];
}

/** Reader role, closure table, and host-org-table sync for tenancy. */
function tenancyInit(cfg: ResolvedConfig): string[] {
  const { schema: s } = cfg;
  const tn = cfg.tenancy!;
  const t = tenantPg(tn.type);
  const statements = [
    `DO $litics$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'litics_reader') THEN
        CREATE ROLE litics_reader NOLOGIN;
    END IF;
END $litics$`,
    `GRANT USAGE ON SCHEMA ${s} TO litics_reader`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA ${s} TO litics_reader`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT SELECT ON TABLES TO litics_reader`,
  ];
  if (!tn.hierarchy) return statements;

  const host = qtable(tn.hierarchy.table);
  const id = qid(tn.hierarchy.id);
  const parent = qid(tn.hierarchy.parent);
  statements.push(
    // Closure table: one row per (ancestor, descendant) pair incl. self.
    `CREATE TABLE ${s}.org_tree (
    ancestor   ${t} NOT NULL,
    descendant ${t} NOT NULL,
    depth      int  NOT NULL,
    PRIMARY KEY (ancestor, descendant)
)`,
    `CREATE INDEX org_tree_descendant ON ${s}.org_tree (descendant)`,
    `GRANT SELECT ON ${s}.org_tree TO litics_reader`,
    // Full rebuild from the host table (also the initial backfill).
    `CREATE OR REPLACE FUNCTION ${s}.rebuild_org_tree()
RETURNS bigint LANGUAGE plpgsql AS $litics$
DECLARE
    v_rows bigint;
BEGIN
    TRUNCATE ${s}.org_tree;
    INSERT INTO ${s}.org_tree (ancestor, descendant, depth)
    WITH RECURSIVE walk AS (
        SELECT o.${id} AS descendant, o.${id} AS ancestor, 0 AS depth FROM ${host} o
        UNION ALL
        SELECT w.descendant, o.${parent}, w.depth + 1
          FROM walk w JOIN ${host} o ON o.${id} = w.ancestor
         WHERE o.${parent} IS NOT NULL
    )
    SELECT ancestor, descendant, depth FROM walk;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END $litics$`,
    `SELECT ${s}.rebuild_org_tree()`,
    // Incremental maintenance: inserts attach to the parent's ancestry;
    // re-parenting detaches the subtree from old ancestors and re-attaches.
    `CREATE OR REPLACE FUNCTION ${s}.litics_org_tree_sync()
RETURNS trigger LANGUAGE plpgsql AS $litics$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO ${s}.org_tree VALUES (NEW.${id}, NEW.${id}, 0)
        ON CONFLICT DO NOTHING;
        IF NEW.${parent} IS NOT NULL THEN
            INSERT INTO ${s}.org_tree
            SELECT o.ancestor, NEW.${id}, o.depth + 1
              FROM ${s}.org_tree o WHERE o.descendant = NEW.${parent}
            ON CONFLICT DO NOTHING;
        END IF;
    ELSIF TG_OP = 'UPDATE' AND OLD.${parent} IS DISTINCT FROM NEW.${parent} THEN
        DELETE FROM ${s}.org_tree o
         USING ${s}.org_tree sub
         WHERE sub.ancestor = NEW.${id}
           AND o.descendant = sub.descendant
           AND o.ancestor NOT IN (SELECT descendant FROM ${s}.org_tree WHERE ancestor = NEW.${id});
        IF NEW.${parent} IS NOT NULL THEN
            INSERT INTO ${s}.org_tree
            SELECT up.ancestor, down.descendant, up.depth + down.depth + 1
              FROM ${s}.org_tree up, ${s}.org_tree down
             WHERE up.descendant = NEW.${parent} AND down.ancestor = NEW.${id}
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;
    RETURN NEW;
END $litics$`,
    `CREATE TRIGGER litics_org_tree AFTER INSERT OR UPDATE ON ${host}
FOR EACH ROW EXECUTE FUNCTION ${s}.litics_org_tree_sync()`,
  );
  return statements;
}
