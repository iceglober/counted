import { CenteredPage, Panel } from "../../components/layout";
import { ClaimProject } from "../../components/claim-project";
import { attempt } from "../../lib/client";
import { clientForCaller } from "../../lib/session";
import { requireAccount } from "../../lib/guard";
import { can } from "../../lib/permissions";

export const dynamic = "force-dynamic";
export default async function ClaimPage() {
  const account = requireAccount(await attempt((await clientForCaller()).account.me({})), "/claim");
  const workspaces = account.workspaces.filter((one) => can(account, one.id, "projects:write"));
  return <CenteredPage><header className="space-y-3"><h1 className="font-heading text-2xl">Keep your project.</h1><p className="text-sm text-muted-foreground">Bring a provisioned project into your workspace. Its events and ingest key stay with it.</p></header><Panel title="Claim a project"><ClaimProject workspaces={workspaces} /></Panel></CenteredPage>;
}
