import type { DashboardLayout } from "./types";

export function createAgentDashboardLayout(): DashboardLayout {
  return {
    insights: [
      {
        id: "a1",
        type: "timeseries",
        title: "Sessions over time",
        span: 3,
        query: { measure: "unique_sessions", timeBucket: "day" },
      },
      {
        id: "a2",
        type: "breakdown",
        title: "Tool usage",
        span: 2,
        query: {
          measure: "count",
          eventFilter: { names: ["tool_use"] },
          groupBy: [{ type: "property", key: "tool" }],
          orderBy: { field: "value", direction: "desc" },
          limit: 15,
        },
      },
      {
        id: "a3",
        type: "breakdown",
        title: "Tool outcomes",
        span: 1,
        query: {
          measure: "count",
          eventFilter: { names: ["tool_use"] },
          groupBy: [{ type: "property", key: "outcome" }],
          orderBy: { field: "value", direction: "desc" },
          limit: 5,
        },
      },
      {
        id: "a4",
        type: "breakdown",
        title: "Events by type",
        span: 1,
        query: {
          measure: "count",
          groupBy: [{ type: "system", key: "event_name" }],
          orderBy: { field: "value", direction: "desc" },
          limit: 10,
        },
      },
      {
        id: "a5",
        type: "breakdown",
        title: "Files edited",
        span: 1,
        query: {
          measure: "count",
          eventFilter: { names: ["file_edit"] },
          groupBy: [{ type: "property", key: "language" }],
          orderBy: { field: "value", direction: "desc" },
          limit: 10,
        },
      },
      {
        id: "a6",
        type: "breakdown",
        title: "File actions",
        span: 1,
        query: {
          measure: "count",
          eventFilter: { names: ["file_edit"] },
          groupBy: [{ type: "property", key: "action" }],
          orderBy: { field: "value", direction: "desc" },
          limit: 5,
        },
      },
      {
        id: "a7",
        type: "timeseries",
        title: "Tool use over time",
        span: 2,
        query: {
          measure: "count",
          eventFilter: { names: ["tool_use"] },
          timeBucket: "day",
        },
      },
      {
        id: "a8",
        type: "breakdown",
        title: "Commands run",
        span: 1,
        query: {
          measure: "count",
          eventFilter: { names: ["command_run"] },
          groupBy: [{ type: "property", key: "command" }],
          orderBy: { field: "value", direction: "desc" },
          limit: 10,
        },
      },
    ],
  };
}
