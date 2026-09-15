import type { ContractOutputs } from "./client";
type Permission =
  ContractOutputs["credentials"]["listForWorkspace"]["grantablePermissions"][number];
const labels: Record<Permission, string> = {
  "events:write": "Send events",
  "queries:run": "Run analytics queries",
  "projects:read": "Read projects",
  "projects:write": "Create and edit projects",
  "projects:delete": "Delete projects",
  "dashboards:read": "Read dashboards",
  "dashboards:write": "Manage dashboards",
  "monitors:read": "Read monitors",
  "monitors:write": "Manage monitors",
  "credentials:read": "Read API key details",
  "credentials:write": "Manage API keys",
  "workspace:read": "Read workspace details",
  "workspace:admin": "Manage workspace",
  "billing:read": "Read billing details",
  "billing:write": "Manage billing",
};
export const permissionLabel = (permission: Permission): string =>
  labels[permission];
