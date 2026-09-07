"use client";

import { useEffect, useState } from "react";
import { Button } from "@counted/ui/components/button";
import { Alert, AlertDescription } from "@counted/ui/components/alert";
import { authProblem, authRequest } from "../lib/auth-request";
import { signInPath } from "../lib/auth-navigation";
import { z } from "zod";

const InvitationDetails = z.object({ id: z.string(), organizationId: z.string(), organizationName: z.string(), email: z.string(), role: z.string() });
export function InvitationResponse({ invitationId, email }: { invitationId: string; email: string }) {
  const [details, setDetails] = useState<z.infer<typeof InvitationDetails> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [declined, setDeclined] = useState(false);
  const load = async () => {
    setProblem(null);
    try { setDetails(InvitationDetails.parse(await authRequest(`/organization/get-invitation?${new URLSearchParams({ id: invitationId })}`))); }
    catch (error) { setProblem(authProblem(error)); }
  };
  useEffect(() => { void load(); }, [invitationId]);
  const respond = async (accept: boolean) => {
    if (!details) return;
    setPending(true); setProblem(null);
    try {
      await authRequest(`/organization/${accept ? "accept" : "reject"}-invitation`, { invitationId });
      if (accept) window.location.assign(`/w/${encodeURIComponent(details.organizationId)}/dashboards`);
      else setDeclined(true);
    } catch (error) { setProblem(authProblem(error)); }
    finally { setPending(false); }
  };
  const switchAccount = async () => {
    setPending(true);
    try { await authRequest("/sign-out", {}); window.location.assign(signInPath(`/invitations/${encodeURIComponent(invitationId)}`)); }
    catch (error) { setProblem(authProblem(error)); setPending(false); }
  };
  return <div className="space-y-5">
    <p className="text-sm text-muted-foreground">Signed in as <span className="break-all font-medium text-foreground">{email}</span>.</p>
    {declined ? <p>Invitation declined.</p> : details ? <>
      <p>Join <strong>{details.organizationName}</strong> as {details.role}.</p>
      <div className="flex flex-wrap gap-3"><Button onClick={() => void respond(true)} disabled={pending}>Accept invitation</Button><Button variant="outline" onClick={() => void respond(false)} disabled={pending}>Decline</Button></div>
    </> : !problem ? <p role="status" className="text-sm text-muted-foreground">Loading invitation…</p> : null}
    {problem && <Alert variant="destructive"><AlertDescription>{problem} Invitations must be accepted with the invited email address. Expired or revoked invitations require a new invitation from the workspace owner.</AlertDescription></Alert>}
    {!declined && <Button variant="ghost" onClick={() => void switchAccount()} disabled={pending}>Use another account</Button>}
    {problem && <Button variant="outline" onClick={() => void load()} disabled={pending}>Try again</Button>}
  </div>;
}
