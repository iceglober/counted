import type { Measure, GroupBy, PropFilter, InsightQuery, TimeRange } from "./types";

const SYSTEM_COLUMNS = new Set([
  "os_name",
  "os_version",
  "locale",
  "app_version",
  "device_model",
  "event_name",
  "session_id",
]);

const VALID_OPERATORS = new Set(["eq", "neq", "contains", "gt", "lt", "in"]);
const VALID_AGGREGATIONS = new Set(["sum", "avg", "min", "max"]);
const VALID_TIME_BUCKETS = new Set(["hour", "day", "week", "month"]);
const VALID_TIME_UNITS = new Set(["hours", "days", "weeks", "months"]);
const VALID_ORDER_DIRECTIONS = new Set(["asc", "desc"]);

function measureToSql(measure: Measure, params: unknown[]): string {
  if (measure === "count") return "COUNT(*)";
  if (measure === "unique_sessions") return "COUNT(DISTINCT session_id)";
  if (measure === "unique_users") return "COUNT(DISTINCT session_id)";

  if (!VALID_AGGREGATIONS.has(measure.aggregation)) {
    throw new Error(`Invalid aggregation: ${measure.aggregation}`);
  }
  params.push(measure.property);
  return `${measure.aggregation.toUpperCase()}((jsonb_extract_path_text(props, $${params.length}))::numeric)`;
}

function groupByToSql(g: GroupBy, params: unknown[]): string {
  if (g.type === "system") {
    if (!SYSTEM_COLUMNS.has(g.key)) {
      throw new Error(`Invalid system column: ${g.key}`);
    }
    return g.key;
  }
  if (g.type === "property") {
    params.push(g.key);
    return `jsonb_extract_path_text(props, $${params.length})`;
  }
  if (g.type === "time") {
    if (!VALID_TIME_BUCKETS.has(g.bucket)) {
      throw new Error(`Invalid time bucket: ${g.bucket}`);
    }
    return `date_trunc('${g.bucket}', timestamp)`;
  }
  return "";
}

function timeRangeToCondition(timeRange: TimeRange, params: unknown[]): string {
  if (timeRange.type === "relative") {
    if (!VALID_TIME_UNITS.has(timeRange.unit)) {
      throw new Error(`Invalid time unit: ${timeRange.unit}`);
    }
    params.push(timeRange.value);
    return `timestamp >= NOW() - make_interval(${timeRange.unit} => $${params.length})`;
  }

  params.push(timeRange.start);
  params.push(timeRange.end);
  return `timestamp >= $${params.length - 1}::timestamptz AND timestamp <= $${params.length}::timestamptz`;
}

function filterToCondition(f: PropFilter, params: unknown[]): string {
  if (!VALID_OPERATORS.has(f.operator)) {
    throw new Error(`Invalid filter operator: ${f.operator}`);
  }

  let col: string;
  if (SYSTEM_COLUMNS.has(f.field)) {
    col = f.field;
  } else {
    params.push(f.field);
    col = `jsonb_extract_path_text(props, $${params.length})`;
  }

  switch (f.operator) {
    case "eq":
      params.push(f.value);
      return `${col} = $${params.length}`;
    case "neq":
      params.push(f.value);
      return `${col} != $${params.length}`;
    case "contains":
      params.push(`%${f.value}%`);
      return `${col} ILIKE $${params.length}`;
    case "gt":
      params.push(f.value);
      return `(${col})::numeric > $${params.length}`;
    case "lt":
      params.push(f.value);
      return `(${col})::numeric < $${params.length}`;
    case "in": {
      const values = f.value as string[];
      const placeholders = values.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `${col} IN (${placeholders.join(", ")})`;
    }
  }
}

export function buildQuery(
  projectId: string,
  query: InsightQuery,
  timeRange: TimeRange,
): { sql: string; params: unknown[] } {
  const selectParts: string[] = [];
  const groupByParts: string[] = [];
  const conditions: string[] = [];
  const params: unknown[] = [];

  params.push(projectId);
  conditions.push(`project_id = $${params.length}`);

  conditions.push(timeRangeToCondition(timeRange, params));

  if (query.eventFilter?.names?.length) {
    const placeholders = query.eventFilter.names.map((name) => {
      params.push(name);
      return `$${params.length}`;
    });
    conditions.push(`event_name IN (${placeholders.join(", ")})`);
  }

  if (query.eventFilter?.properties) {
    for (const f of query.eventFilter.properties) {
      conditions.push(filterToCondition(f, params));
    }
  }

  if (query.timeBucket) {
    if (!VALID_TIME_BUCKETS.has(query.timeBucket)) {
      throw new Error(`Invalid time bucket: ${query.timeBucket}`);
    }
    const bucketExpr = `time_bucket('1 ${query.timeBucket}', timestamp)`;
    selectParts.push(`${bucketExpr} AS bucket`);
    groupByParts.push(bucketExpr);
  }

  if (query.groupBy) {
    for (const g of query.groupBy) {
      const expr = groupByToSql(g, params);
      const alias = g.type === "time" ? "bucket" : g.type === "system" ? g.key : g.key;
      selectParts.push(`${expr} AS "${alias}"`);
      groupByParts.push(expr);
    }
  }

  selectParts.push(`${measureToSql(query.measure, params)} AS value`);

  let sqlStr = `SELECT ${selectParts.join(", ")} FROM events WHERE ${conditions.join(" AND ")}`;

  if (groupByParts.length > 0) {
    sqlStr += ` GROUP BY ${groupByParts.join(", ")}`;
  }

  if (query.orderBy) {
    const validOrderFields = new Set([...SYSTEM_COLUMNS, "bucket", "value"]);
    if (query.groupBy) {
      for (const g of query.groupBy) {
        if (g.type === "system" || g.type === "property") validOrderFields.add(g.key);
      }
    }
    if (!validOrderFields.has(query.orderBy.field)) {
      throw new Error(`Invalid orderBy field: ${query.orderBy.field}`);
    }
    if (!VALID_ORDER_DIRECTIONS.has(query.orderBy.direction)) {
      throw new Error(`Invalid orderBy direction: ${query.orderBy.direction}`);
    }
    sqlStr += ` ORDER BY "${query.orderBy.field}" ${query.orderBy.direction}`;
  } else if (query.timeBucket) {
    sqlStr += ` ORDER BY bucket`;
  }

  if (query.limit) {
    params.push(query.limit);
    sqlStr += ` LIMIT $${params.length}`;
  }

  return { sql: sqlStr, params };
}
