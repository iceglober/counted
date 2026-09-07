import type { AccountId, Instant, WorkspaceId } from "@counted/kernel";

/** The identity half of a workspace; a missing owner is an observable orphan. */
export type OrganizationRecord = {
  readonly workspace: WorkspaceId;
  readonly name: string;
  readonly owner: AccountId | null;
  readonly createdAt: Instant;
};
export type OrganizationCursor = { readonly createdAt: Instant; readonly workspace: WorkspaceId };
export interface OrganizationDirectory {
  /** Stable ascending (createdAt, id) pagination. Excludes the internal holding organization. */
  page(input: { readonly since: Instant; readonly cursor: OrganizationCursor | null; readonly limit: number }): Promise<{ readonly items: readonly OrganizationRecord[]; readonly cursor: OrganizationCursor | null }>;
}
