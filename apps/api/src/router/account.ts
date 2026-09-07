/**
 * The caller's own account, and every workspace it reaches.
 *
 * The two facts travel together because the console asks both on every page
 * load and they are never useful apart. A service key answers as the account
 * that issued it, which is what lets an object created through a key have a
 * truthful author — v1 wrote an empty string.
 */

import { raise } from "../faults";
import * as serialize from "../serialize";
import { actingAccount } from "./support";
import type { HandlerDeps } from "./deps";

export const accountRoutes = ({ deps, guarded }: HandlerDeps) => ({
  me: guarded.account.me.handler(async ({ context }) => {
    const id = actingAccount(context.authority.principal);
    const person = await deps.identity.accounts.find(id);
    if (person === null) {
      // The session or key resolved to an account row that no longer exists.
      // A 404 rather than a 401: the credential was valid, and telling the
      // caller "sign in again" would send them round a loop that cannot end.
      raise({
        code: "NOT_FOUND",
        message: "No such account.",
        data: { reason: "NoSuchAccount", account: String(id) },
      });
    }
    return {
      account: serialize.account(person),
      workspaces: context.authority.reach.map(serialize.workspaceSummary),
    };
  }),
});
