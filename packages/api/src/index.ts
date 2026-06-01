export type TimeRange =
  | { type: "relative"; value: number; unit: "hours" | "days" | "weeks" | "months" }
  | { type: "absolute"; start: string; end: string };

export type PropFilter = {
  field: string;
  operator: "eq" | "neq" | "contains" | "gt" | "lt" | "in";
  value: string | number | string[];
};

export type Measure =
  | "count"
  | "unique_sessions"
  | "unique_users"
  | { property: string; aggregation: "sum" | "avg" | "min" | "max" };

export type InsightQuery = {
  measure: Measure;
  eventFilter?: {
    names?: string[];
    properties?: PropFilter[];
  };
  groupBy?: { type: "property" | "system" | "time"; key: string }[];
  timeBucket?: "hour" | "day" | "week" | "month";
  orderBy?: { field: string; direction: "asc" | "desc" };
  limit?: number;
  funnelSteps?: string[];
  retentionPeriod?: "day" | "week" | "month";
  retentionPeriods?: number;
};

export type Project = {
  id: string;
  name: string;
  clientKey: string;
  createdAt: string;
};

export type Dashboard = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  layout: unknown;
  isDefault: boolean;
  shareToken: string | null;
  createdAt: string;
};

export type Alert = {
  id: string;
  projectId: string;
  name: string;
  metric: string;
  eventFilter: string | null;
  condition: "above" | "below";
  threshold: string;
  window: string;
  channels: string[];
  enabled: boolean;
  lastTriggeredAt: string | null;
  lastValue: string | null;
  createdAt: string;
};

export type ProjectSchema = {
  eventNames: { name: string; count: number }[];
  propKeys: string[];
  numericPropKeys: string[];
  systemFields: {
    osNames: string[];
    locales: string[];
    appVersions: string[];
  };
};

export type QueryResult = {
  data: Record<string, unknown>[];
  meta: { totalEvents: number; executionMs: number };
};

export type EventInput = {
  eventName: string;
  sessionId: string;
  timestamp?: string;
  props?: Record<string, string | number | boolean | null>;
  systemProps?: {
    osName?: string;
    osVersion?: string;
    locale?: string;
    appVersion?: string;
    deviceModel?: string;
    isDebug?: boolean;
    sdkVersion?: string;
  };
};

type RequestOptions = {
  signal?: AbortSignal;
};

export class CountedClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(options: {
    host?: string;
    sessionToken?: string;
    projectKey?: string;
  }) {
    this.baseUrl = (options.host ?? "https://app.counted.dev").replace(
      /\/$/,
      "",
    );
    this.headers = { "Content-Type": "application/json" };

    if (options.sessionToken) {
      this.headers["Cookie"] =
        `better-auth.session_token=${options.sessionToken}`;
    }
    if (options.projectKey) {
      this.headers["Project-Key"] = options.projectKey;
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/v0${path}`, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: opts?.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(
        `Counted API error ${res.status}: ${err.error ?? res.statusText}`,
      );
    }

    if (res.status === 204) return undefined as T;
    return res.json();
  }

  // ─── Ingestion ────────────────────────────────────────────────────────────

  async ingest(
    events: EventInput | EventInput[],
    opts?: RequestOptions,
  ): Promise<void> {
    await this.request("POST", "/event", events, opts);
  }

  // ─── Projects ─────────────────────────────────────────────────────────────

  async listProjects(opts?: RequestOptions): Promise<Project[]> {
    return this.request("GET", "/projects", undefined, opts);
  }

  async createProject(
    name: string,
    opts?: RequestOptions,
  ): Promise<Project> {
    return this.request("POST", "/projects", { name }, opts);
  }

  async updateProject(
    id: string,
    updates: { name?: string },
    opts?: RequestOptions,
  ): Promise<Project> {
    return this.request("PATCH", `/projects/${id}`, updates, opts);
  }

  async deleteProject(id: string, opts?: RequestOptions): Promise<void> {
    await this.request("DELETE", `/projects/${id}`, undefined, opts);
  }

  async getProjectSchema(
    id: string,
    opts?: RequestOptions,
  ): Promise<ProjectSchema> {
    return this.request("GET", `/projects/${id}/schema`, undefined, opts);
  }

  async rotateKeys(
    id: string,
    type: "client" | "server" = "client",
    opts?: RequestOptions,
  ): Promise<{ clientKey: string; serverKey: string }> {
    return this.request("POST", `/projects/${id}/keys`, { type }, opts);
  }

  async exportEvents(
    id: string,
    options?: { format?: "json" | "csv"; limit?: number },
    opts?: RequestOptions,
  ): Promise<unknown[]> {
    const params = new URLSearchParams();
    if (options?.format) params.set("format", options.format);
    if (options?.limit) params.set("limit", String(options.limit));
    const qs = params.toString();
    return this.request(
      "GET",
      `/projects/${id}/export${qs ? `?${qs}` : ""}`,
      undefined,
      opts,
    );
  }

  // ─── Query ────────────────────────────────────────────────────────────────

  async query(
    projectId: string,
    query: InsightQuery,
    timeRange?: TimeRange,
    opts?: RequestOptions,
  ): Promise<QueryResult> {
    return this.request("POST", "/query", { projectId, query, timeRange }, opts);
  }

  // ─── Dashboards ───────────────────────────────────────────────────────────

  async listDashboards(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<Dashboard[]> {
    return this.request(
      "GET",
      `/dashboards?projectId=${projectId}`,
      undefined,
      opts,
    );
  }

  async createDashboard(
    data: {
      projectId: string;
      name: string;
      slug: string;
      layout?: unknown;
      isDefault?: boolean;
    },
    opts?: RequestOptions,
  ): Promise<Dashboard> {
    return this.request("POST", "/dashboards", data, opts);
  }

  async updateDashboard(
    id: string,
    updates: {
      name?: string;
      slug?: string;
      layout?: unknown;
      isDefault?: boolean;
    },
    opts?: RequestOptions,
  ): Promise<Dashboard> {
    return this.request("PUT", `/dashboards/${id}`, updates, opts);
  }

  async deleteDashboard(id: string, opts?: RequestOptions): Promise<void> {
    await this.request("DELETE", `/dashboards/${id}`, undefined, opts);
  }

  async shareDashboard(
    id: string,
    opts?: RequestOptions,
  ): Promise<{ shareToken: string }> {
    return this.request("POST", `/dashboards/${id}/share`, undefined, opts);
  }

  async unshareDashboard(id: string, opts?: RequestOptions): Promise<void> {
    await this.request("DELETE", `/dashboards/${id}/share`, undefined, opts);
  }

  // ─── Alerts ───────────────────────────────────────────────────────────────

  async listAlerts(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<Alert[]> {
    return this.request(
      "GET",
      `/alerts?projectId=${projectId}`,
      undefined,
      opts,
    );
  }

  async createAlert(
    data: {
      projectId: string;
      name: string;
      metric: string;
      condition: "above" | "below";
      threshold: number;
      eventFilter?: string;
      window?: string;
      channels?: string[];
      slackWebhookUrl?: string;
    },
    opts?: RequestOptions,
  ): Promise<Alert> {
    return this.request("POST", "/alerts", data, opts);
  }

  async updateAlert(
    id: string,
    updates: {
      enabled?: boolean;
      name?: string;
      threshold?: number;
      condition?: "above" | "below";
      window?: string;
      channels?: string[];
      slackWebhookUrl?: string;
    },
    opts?: RequestOptions,
  ): Promise<Alert> {
    return this.request("PATCH", "/alerts", { id, ...updates }, opts);
  }

  async deleteAlert(id: string, opts?: RequestOptions): Promise<void> {
    await this.request("DELETE", `/alerts?id=${id}`, undefined, opts);
  }

  // ─── Dashboard Data ───────────────────────────────────────────────────────

  async getDashboardData(
    projectId: string,
    options?: { dashboardId?: string; timeRange?: TimeRange },
    opts?: RequestOptions,
  ): Promise<{ insights: unknown[]; dashboardId: string | null }> {
    return this.request(
      "POST",
      "/dashboard-data",
      { projectId, ...options },
      opts,
    );
  }
}
