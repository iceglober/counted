/**
 * Who the caller is, once per request.
 *
 * Every page needs the same two facts — am I signed in, and which workspaces
 * may I see — and they come from `/v1/me`, the same endpoint an integrator
 * calls. Nothing here caches a "current workspace": an account can belong to
 * several, and a remembered one is a fourth piece of state free to disagree
 * with the URL, the API and the other tab.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError, serverApi, type ApiClient } from "./api";

export type Workspace = { readonly id: string; readonly name: string; readonly role: "owner" | "admin" | "member" };

export type Caller = {
  readonly api: ApiClient;
  readonly principal: string;
  readonly workspaces: readonly Workspace[];
};

type Me = { kind: string; principal: string; workspaces: Workspace[] };

/**
 * Resolve the caller, or send them to sign in.
 *
 * `redirect` throws, so callers do not have to handle the anonymous case —
 * which is what stops a page from rendering half a shell for somebody who is
 * not signed in.
 */
export const requireCaller = async (): Promise<Caller> => {
  const api = serverApi((await cookies()).toString() || null);
  try {
    const { data } = await api<Me>("describeCaller");
    if (data.kind !== "account") redirect("/sign-in");
    return { api, principal: data.principal, workspaces: data.workspaces };
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthenticated) redirect("/sign-in");
    throw error;
  }
};

/**
 * The workspace a page is about.
 *
 * Named in the URL, and checked against what the caller may actually see — so
 * a hand-typed id belonging to somebody else is a redirect rather than a
 * request the API will refuse with a 404 the page then has to interpret.
 */
export const workspaceFrom = (caller: Caller, requested: string | undefined): Workspace => {
  if (requested !== undefined) {
    const found = caller.workspaces.find((workspace) => workspace.id === requested);
    if (found === undefined) redirect("/dashboards");
    return found;
  }
  const first = caller.workspaces[0];
  // No workspace yet means the bootstrap path, not the marketing page.
  if (first === undefined) redirect("/start");
  return first;
};
