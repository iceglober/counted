import { redirect } from "next/navigation";
import { attempt } from "../../lib/client";
import { clientForCaller } from "../../lib/session";
import { requireAccount } from "../../lib/guard";

export const dynamic = "force-dynamic";
export default async function ExplorerHome() {
  const client = await clientForCaller();
  const me = requireAccount(await attempt(client.account.me({})));
  const workspace = me.workspaces[0];
  redirect(workspace ? `/w/${workspace.id}/api-explorer` : "/welcome");
}
