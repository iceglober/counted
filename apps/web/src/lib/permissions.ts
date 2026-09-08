import type { ContractOutputs } from "./client";

/** Presentation hint from the same grant table as the API. The API enforces access. */
export const can = (account: ContractOutputs["account"]["me"], workspaceId: string, permission: ContractOutputs["account"]["me"]["workspaces"][number]["permissions"][number]): boolean => {
  return account.workspaces.find(one => one.id === workspaceId)?.permissions.includes(permission) ?? false;
};
