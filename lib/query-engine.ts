import { sql } from "drizzle-orm";

type Measure =
  | "count"
  | "unique_sessions"
  | "unique_users"
  | { property: string; aggregation: string };

type GroupBy =
  | { type: "property"; key: string }
  | { type: "system"; key: string }
  | { type: "time"; bucket: string };

type PropFilter = {
  field: string;
  operator: "eq" | "neq" | "contains" | "gt" | "lt" | "in";
  value: string | number | string[];
};

type WidgetQuery = {
  measure: Measure;
  eventFilter?: {
    names?: string[];
    properties?: PropFilter[];
  };
  groupBy?: GroupBy[];
  timeBucket?: "hour" | "day" | "week" | "month";
  orderBy?: { field: string; direction: "asc" | "desc" };
  limit?: number;
};

type TimeRange =
  | { type: "relative"; value: number; unit: string }
  | { type: "absolute"; start: string; end: string };

const SYSTEM_COLUMNS = new Set([
  "os_name",
  "os_version",
  "locale",
  "app_version",
  "device_model",
  "event_name",
  "session_id",
]);

function measureToSql(measure: Measure): string {
  if (measure === "count") return "COUNT(*)";
  if (measure === "unique_sessions") return "COUNT(DISTINCT session_id)";
  if (measure === "unique_users") return "COUNT(DISTINCT session_id)";
  return `${measure.aggregation.toUpperCase()}((props->>'${measure.property}')::numeric)`;
}

function groupByToSql(g: GroupBy): string {
  if (g.type === "system") return g.key;
  if (g.type === "property") return `props->>'${g.key}'`;
  if (g.type === "time") return `time_bucket('1 ${g.bucket}', timestamp)`;
  return "";
}

function timeRangeToCondition(timeRange: TimeRange): string {
  if (timeRange.type === "relative") {
    return `timestamp >= NOW() - INTERVAL '${timeRange.value} ${timeRange.unit}'`;
  }
  return `timestamp >= '${timeRange.start}' AND timestamp <= '${timeRange.end}'`;
}

function filterToCondition(f: PropFilter): string {
  const col = SYSTEM_COLUMNS.has(f.field) ? f.field : `props->>'${f.field}'`;
  switch (f.operator) {
    case "eq":
      return `${col} = '${f.value}'`;
    case "neq":
      return `${col} != '${f.value}'`;
    case "contains":
      return `${col} ILIKE '%${f.value}%'`;
    case "gt":
      return `(${col})::numeric > ${f.value}`;
    case "lt":
      return `(${col})::numeric < ${f.value}`;
    case "in":
      return `${col} IN (${(f.value as string[]).map((v) => `'${v}'`).join(", ")})`;
  }
}

export function buildQuery(
  projectId: string,
  query: WidgetQuery,
  timeRange: TimeRange,
): { sql: string; params: any[] } {
  const selectParts: string[] = [];
  const groupByParts: string[] = [];
  const conditions: string[] = [`project_id = $1`];
  const params: any[] = [projectId];

  conditions.push(timeRangeToCondition(timeRange));

  if (query.eventFilter?.names?.length) {
    const placeholders = query.eventFilter.names.map((_, i) => `$${params.length + i + 1}`);
    params.push(...query.eventFilter.names);
    conditions.push(`event_name IN (${placeholders.join(", ")})`);
  }

  if (query.eventFilter?.properties) {
    for (const f of query.eventFilter.properties) {
      conditions.push(filterToCondition(f));
    }
  }

  if (query.timeBucket) {
    const bucketExpr = `time_bucket('1 ${query.timeBucket}', timestamp)`;
    selectParts.push(`${bucketExpr} AS bucket`);
    groupByParts.push(bucketExpr);
  }

  if (query.groupBy) {
    for (const g of query.groupBy) {
      const expr = groupByToSql(g);
      const alias = g.type === "time" ? "bucket" : g.type === "system" ? g.key : g.key;
      selectParts.push(`${expr} AS "${alias}"`);
      groupByParts.push(expr);
    }
  }

  selectParts.push(`${measureToSql(query.measure)} AS value`);

  let sqlStr = `SELECT ${selectParts.join(", ")} FROM events WHERE ${conditions.join(" AND ")}`;

  if (groupByParts.length > 0) {
    sqlStr += ` GROUP BY ${groupByParts.join(", ")}`;
  }

  if (query.orderBy) {
    sqlStr += ` ORDER BY "${query.orderBy.field}" ${query.orderBy.direction}`;
  } else if (query.timeBucket) {
    sqlStr += ` ORDER BY bucket`;
  }

  if (query.limit) {
    sqlStr += ` LIMIT ${query.limit}`;
  }

  return { sql: sqlStr, params };
}
