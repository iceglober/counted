import type { DashboardLayout } from "./types";

export function createDefaultLayout(): DashboardLayout {
  return {
    insights: [
      {
        id: "i1",
        type: "breakdown",
        title: "Top Events",
        span: 2,
        query: {
          measure: "count",
          groupBy: [{ type: "system", key: "event_name" }],
          orderBy: { field: "value", direction: "desc" },
          limit: 10,
        },
      },
      {
        id: "i2",
        type: "timeseries",
        title: "Events over time",
        span: 2,
        query: { measure: "count", timeBucket: "day" },
      },
      {
        id: "i3",
        type: "breakdown",
        title: "Operating Systems",
        span: 2,
        query: {
          measure: "count",
          groupBy: [{ type: "system", key: "os_name" }],
          orderBy: { field: "value", direction: "desc" },
          limit: 10,
        },
      },
      {
        id: "i4",
        type: "breakdown",
        title: "App Versions",
        span: 2,
        query: {
          measure: "count",
          groupBy: [{ type: "system", key: "app_version" }],
          orderBy: { field: "value", direction: "desc" },
          limit: 10,
        },
      },
    ],
  };
}
