import { Card, CardContent, CardHeader } from "@counted/ui/components/card";
import { CenteredPage } from "../../../components/layout";
import { InvitationResponse } from "../../../components/invitation-response";
import { attempt } from "../../../lib/client";
import { clientForCaller } from "../../../lib/session";
import { requireAccount } from "../../../lib/guard";

export const dynamic = "force-dynamic";
export default async function InvitationPage({ params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params;
  const account = requireAccount(await attempt((await clientForCaller()).account.me({})), `/invitations/${encodeURIComponent(invitationId)}`);
  return <CenteredPage><Card><CardHeader><h1 className="font-heading text-xl">Workspace invitation</h1></CardHeader><CardContent><InvitationResponse invitationId={invitationId} email={account.account.email} /></CardContent></Card></CenteredPage>;
}
