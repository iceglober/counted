"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@counted/ui/components/table";
import { Button } from "@counted/ui/components/button";
import { Badge } from "@counted/ui/components/badge";
import { Alert, AlertDescription } from "@counted/ui/components/alert";
import { authProblem, authRequest } from "../lib/auth-request";

const PendingInvite = z.object({ id: z.string(), email: z.string(), role: z.string(), status: z.string(), expiresAt: z.string() });
export function PendingInvitations({ workspaceId, emailEnabled = true }: { workspaceId: string; emailEnabled?: boolean }) {
  const [items, setItems] = useState<z.infer<typeof PendingInvite>[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = async () => {
    try {
      const values = z.array(PendingInvite).parse(await authRequest(`/organization/list-invitations?${new URLSearchParams({ organizationId: workspaceId })}`));
      setItems(values.filter((one) => one.status === "pending"));
    } catch (error) { setProblem(authProblem(error)); }
  };
  useEffect(() => { void load(); }, [workspaceId]);
  const change = async (item: z.infer<typeof PendingInvite>, resend: boolean) => {
    setPending(item.id); setProblem(null); setNotice(null);
    try {
      await authRequest(`/organization/${resend ? "invite-member" : "cancel-invitation"}`, resend ? { organizationId: workspaceId, email: item.email, role: item.role, resend: true } : { invitationId: item.id });
      setNotice(resend ? `Invitation resent to ${item.email}.` : `Invitation to ${item.email} revoked.`);
      await load();
    } catch (error) { setProblem(authProblem(error)); }
    finally { setPending(null); }
  };
  return <div className="space-y-4">
    {problem && <Alert variant="destructive"><AlertDescription>{problem}</AlertDescription></Alert>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {items === null ? <Button variant="outline" onClick={() => { setProblem(null); void load(); }}>Reload invitations</Button> : items.length === 0 ? <p className="text-sm text-muted-foreground">No pending invitations.</p> : <Table aria-label="Pending invitations">
      <TableHeader><TableRow><TableHead>Email</TableHead><TableHead className="hidden sm:table-cell">Role</TableHead><TableHead className="text-right">Invitation</TableHead></TableRow></TableHeader>
      <TableBody>{items.map((item) => <TableRow key={item.id}>
        <TableCell className="whitespace-normal [overflow-wrap:anywhere]"><p className="font-medium">{item.email}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(item.expiresAt).getTime() < Date.now() ? "Expired" : `Expires ${new Date(item.expiresAt).toLocaleDateString()}`}</p></TableCell>
        <TableCell className="hidden sm:table-cell"><Badge variant="outline" className="capitalize">{item.role}</Badge></TableCell>
        <TableCell><div className="flex flex-wrap justify-end gap-2">{emailEnabled && <Button variant="outline" size="sm" disabled={pending !== null} onClick={() => void change(item, true)}>Resend</Button>}<Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => void change(item, false)}>Revoke</Button></div></TableCell>
      </TableRow>)}</TableBody>
    </Table>}
  </div>;
}
