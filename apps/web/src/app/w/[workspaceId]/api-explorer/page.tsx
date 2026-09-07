import { notFound } from "next/navigation";
import { attempt } from "../../../../lib/client";
import { clientForCaller } from "../../../../lib/session";
import { requireAccount } from "../../../../lib/guard";
import { Shell } from "../../../../components/shell";
import { PageHeader } from "../../../../components/layout";
import { ApiExplorer } from "../../../../components/api-explorer/explorer";

export const dynamic = "force-dynamic";
export default async function ExplorerPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const client = await clientForCaller();
  const me = requireAccount(await attempt(client.account.me({})));
  if (!me.workspaces.some((workspace) => workspace.id === workspaceId))
    notFound();
  return (
    <Shell me={me} workspaceId={workspaceId} section="api-explorer">
      <PageHeader
        title="API Explorer"
        purpose="Build a request. Run it with your access. Inspect the result."
      />
      <ApiExplorer workspaceId={workspaceId} />
    </Shell>
  );
}
