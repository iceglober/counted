"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Button } from "@counted/ui/components/button";
import { Input } from "@counted/ui/components/input";
import { Badge } from "@counted/ui/components/badge";
import { Field, FieldLabel } from "@counted/ui/components/field";
import { Alert, AlertDescription } from "@counted/ui/components/alert";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@counted/ui/components/table";
import { Region } from "./layout";
import { authProblem, authRequest } from "../lib/auth-request";

const LoginSession = z.object({ token: z.string(), createdAt: z.string(), expiresAt: z.string() });
const Connection = z.object({ id: z.string(), clientId: z.string(), scopes: z.array(z.string()) });
export function AccountSettings({ email, name, verified, emailEnabled, canClose }: { email: string; name: string | null; verified: boolean; emailEnabled: boolean; canClose: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessions, setSessions] = useState<z.infer<typeof LoginSession>[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [connections, setConnections] = useState<(z.infer<typeof Connection> & { name: string })[] | null>(null);
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const load = async () => {
    try {
      const [listed, active, grants, methods] = await Promise.all([authRequest("/list-sessions"), authRequest("/get-session"), authRequest("/oauth2/get-consents"), authRequest("/list-accounts")]);
      setSessions(z.array(LoginSession).parse(listed));
      setCurrent(z.object({ session: z.object({ token: z.string() }) }).parse(active).session.token);
      setHasPassword(z.array(z.object({ providerId: z.string() })).parse(methods).some((one) => one.providerId === "credential"));
      const consent = z.array(Connection).parse(grants);
      setConnections(await Promise.all(consent.map(async (one) => {
        const client = await authRequest(`/oauth2/public-client?${new URLSearchParams({ client_id: one.clientId })}`).catch(() => null);
        const parsed = z.object({ client_name: z.string().nullish() }).safeParse(client);
        return { ...one, name: parsed.success ? parsed.data.client_name || one.clientId : one.clientId };
      })));
    } catch (error) { setProblem(authProblem(error)); }
  };
  useEffect(() => { void load(); }, []);
  const perform = async (operation: () => Promise<unknown>, success: string) => {
    setPending(true); setProblem(null); setNotice(null);
    try { await operation(); setNotice(success); await load(); router.refresh(); }
    catch (error) { setProblem(authProblem(error)); }
    finally { setPending(false); }
  };
  return <div>
    {problem && <Alert variant="destructive" className="mb-6"><AlertDescription>{problem}</AlertDescription></Alert>}
    {notice && <Alert className="mb-6"><AlertDescription>{notice}</AlertDescription></Alert>}
    <Region title="Profile">
      <form className="grid max-w-md gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void perform(() => authRequest("/update-user", { name: String(form.get("name")) }), "Profile updated."); }}>
        <Field><FieldLabel htmlFor="account-name">Name</FieldLabel><Input id="account-name" name="name" defaultValue={name ?? ""} autoComplete="name" required disabled={pending} /></Field>
        <div className="flex flex-wrap items-center gap-3 text-sm"><span className="break-all">{email}</span><Badge variant="outline">{verified ? "Verified" : "Not verified"}</Badge></div>
        <div className="flex flex-wrap gap-3"><Button type="submit" disabled={pending}>Save name</Button>{!verified && emailEnabled && <Button type="button" variant="outline" disabled={pending} onClick={() => void perform(() => authRequest("/send-verification-email", { email, callbackURL: `${window.location.origin}/account` }), "Verification email sent.")}>Verify email</Button>}</div>
      </form>
    </Region>
    <Region title="Password">
      {hasPassword === true ? <form className="grid max-w-md gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const node = event.currentTarget; void perform(async () => { const password = String(form.get("password")); if (password !== form.get("confirmation")) throw new Error("The passwords do not match."); await authRequest("/change-password", { currentPassword: String(form.get("current")), newPassword: password, revokeOtherSessions: true }); node.reset(); }, "Password changed. Other sessions have been signed out."); }}>
        <Field><FieldLabel htmlFor="current-password">Current password</FieldLabel><Input id="current-password" name="current" type="password" autoComplete="current-password" required disabled={pending} /></Field>
        <Field><FieldLabel htmlFor="account-new-password">New password</FieldLabel><Input id="account-new-password" name="password" type="password" autoComplete="new-password" minLength={8} required disabled={pending} /></Field>
        <Field><FieldLabel htmlFor="account-confirm-password">Confirm password</FieldLabel><Input id="account-confirm-password" name="confirmation" type="password" autoComplete="new-password" minLength={8} required disabled={pending} /></Field>
        <Button type="submit" className="justify-self-start" disabled={pending}>Change password</Button>
      </form> : hasPassword === false ? <><p className="text-sm text-muted-foreground">You sign in with a provider or email link.</p>{emailEnabled && <Button variant="outline" disabled={pending} onClick={() => void perform(() => authRequest("/request-password-reset", { email, redirectTo: `${window.location.origin}/reset-password?next=%2Faccount` }), "Check your email to set a password.")}>Set a password by email</Button>}</> : <p className="text-sm text-muted-foreground">Loading sign-in methods…</p>}
    </Region>
    <Region title="Sessions">
      <p className="text-sm text-muted-foreground">End access on browsers you no longer use.</p>
      {sessions && <Table aria-label="Active sessions"><TableHeader><TableRow><TableHead>Signed in</TableHead><TableHead className="hidden sm:table-cell">Expires</TableHead><TableHead className="text-right">Access</TableHead></TableRow></TableHeader><TableBody>{sessions.map((session) => <TableRow key={session.token}><TableCell>{new Date(session.createdAt).toLocaleString()}</TableCell><TableCell className="hidden sm:table-cell">{new Date(session.expiresAt).toLocaleDateString()}</TableCell><TableCell className="text-right">{session.token === current ? <Badge variant="outline">This browser</Badge> : <Button variant="outline" size="sm" disabled={pending} onClick={() => void perform(() => authRequest("/revoke-session", { token: session.token }), "Session signed out.")}>Sign out</Button>}</TableCell></TableRow>)}</TableBody></Table>}
      {sessions && sessions.length > 1 && <Button variant="outline" disabled={pending} onClick={() => void perform(() => authRequest("/revoke-other-sessions", {}), "Other sessions signed out.")}>Sign out other sessions</Button>}
    </Region>
    <Region title="Connected applications">
      {connections?.length === 0 ? <p className="text-sm text-muted-foreground">No applications connected.</p> : connections && <Table aria-label="Connected applications"><TableHeader><TableRow><TableHead>Application</TableHead><TableHead className="text-right">Access</TableHead></TableRow></TableHeader><TableBody>{connections.map((connection) => <TableRow key={connection.id}><TableCell className="whitespace-normal"><p className="font-medium break-all">{connection.name}</p><p className="mt-1 text-xs text-muted-foreground break-words">{connection.scopes.join(", ")}</p></TableCell><TableCell className="text-right"><Button variant="outline" size="sm" disabled={pending} onClick={() => void perform(() => authRequest("/oauth2/delete-consent", { id: connection.id }), "Application disconnected.")}>Disconnect</Button></TableCell></TableRow>)}</TableBody></Table>}
    </Region>
    {problem && <Button className="mt-5" variant="outline" disabled={pending} onClick={() => void perform(load, "Account details refreshed.")}>Reload account details</Button>}
    <Region title="Close account">
      {canClose ? <form className="grid max-w-md gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void perform(async () => { if (form.get("confirmation") !== "DELETE") throw new Error("Type DELETE to confirm account closure."); await authRequest("/delete-user", hasPassword ? { password: String(form.get("password")) } : {}); window.location.assign("/sign-in"); }, "Account closed."); }}>
        <p className="text-sm text-muted-foreground">Permanently delete your account and end all sessions. This cannot be undone.</p>
        {hasPassword && <Field><FieldLabel htmlFor="close-password">Current password</FieldLabel><Input id="close-password" name="password" type="password" autoComplete="current-password" required disabled={pending} /></Field>}
        <Field><FieldLabel htmlFor="close-confirm">Type DELETE to confirm</FieldLabel><Input id="close-confirm" name="confirmation" autoComplete="off" required disabled={pending} /></Field>
        <Button variant="destructive" type="submit" disabled={pending || hasPassword === null}>Delete account</Button>
      </form> : <p className="text-sm text-muted-foreground">Leave all workspaces before closing your account. Workspace data and subscriptions stay with their remaining owners.</p>}
    </Region>
  </div>;
}
