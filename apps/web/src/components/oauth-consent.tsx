"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@counted/ui/components/button";
import { Alert, AlertDescription } from "@counted/ui/components/alert";
import { authProblem, authRequest } from "../lib/auth-request";

const PublicClient = z.object({ client_id: z.string(), client_name: z.string().nullish() }).passthrough();
const RedirectResponse = z.object({ url: z.string(), redirect: z.literal(true) });
const SCOPE_LABELS: Readonly<Record<string, string>> = {
  openid: "Identify your Counted account",
  profile: "Read your account name",
  email: "Read your email address",
  offline_access: "Stay connected until you revoke access",
  "queries:run": "Run analytics queries",
  "events:write": "Send events",
  "projects:read": "Read projects",
  "projects:write": "Create and update projects",
  "projects:delete": "Delete projects and their events",
  "dashboards:read": "Read dashboards and Insights",
  "dashboards:write": "Create and update dashboards and Insights",
  "monitors:read": "Read monitors",
  "monitors:write": "Create and update monitors",
  "credentials:read": "Read credential details",
  "credentials:write": "Issue and revoke credentials",
  "workspace:read": "Read workspace details and members",
  "workspace:admin": "Manage workspace settings and membership",
  "billing:read": "Read subscription details",
  "billing:write": "Manage billing",
};

/** The provider validates the signed request, registered redirect and consent. */
async function continueAuthorization(query: string, accept?: boolean) {
  const result = RedirectResponse.parse(await authRequest(accept === undefined ? "/oauth2/continue" : "/oauth2/consent", { oauth_query: query, ...(accept === undefined ? { selected: true } : { accept }) }));
  const destination = new URL(result.url, window.location.origin);
  if (!["https:", "http:"].includes(destination.protocol)) throw new Error("The application returned an unsupported redirect address.");
  window.location.assign(destination.toString());
}

export function OAuthConsent({ query, email, continuation = false }: { query: string; email: string; continuation?: boolean }) {
  const params = new URLSearchParams(query);
  const [client, setClient] = useState<z.infer<typeof PublicClient> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const started = useRef(false);
  const load = async () => {
    setProblem(null);
    try { setClient(PublicClient.parse(await authRequest("/oauth2/public-client-prelogin", { client_id: params.get("client_id"), oauth_query: query }))); }
    catch (error) { setProblem(authProblem(error)); }
  };
  const respond = async (accept?: boolean) => {
    setPending(true); setProblem(null);
    try { await continueAuthorization(query, accept); }
    catch (error) { setProblem(authProblem(error)); setPending(false); }
  };
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (continuation) void respond();
    else void load();
  }, [query, continuation]);
  if (continuation) return <div className="space-y-5"><p role="status">Continuing your connection…</p>{problem && <><Alert variant="destructive"><AlertDescription>{problem} Start the connection again if it has expired.</AlertDescription></Alert><Button disabled={pending} onClick={() => void respond()}>Try again</Button></>}</div>;
  return <div className="space-y-5">
    <p className="text-sm text-muted-foreground">Signed in as <span className="break-all font-medium text-foreground">{email}</span>.</p>
    {client ? <>
      <p><strong>{client.client_name || client.client_id}</strong> wants to connect to your Counted account.</p>
      <ul className="space-y-2 pl-5 text-sm list-disc">{(params.get("scope") ?? "").split(" ").filter(Boolean).map((scope) => <li key={scope}>{SCOPE_LABELS[scope] ?? scope}</li>)}</ul>
      <p className="text-sm text-muted-foreground">Access is limited by your current workspace roles. You can revoke this connection from Account settings.</p>
      <div className="flex flex-wrap gap-3"><Button disabled={pending} onClick={() => void respond(true)}>Allow access</Button><Button variant="outline" disabled={pending} onClick={() => void respond(false)}>Deny</Button></div>
    </> : !problem && <p role="status" className="text-sm text-muted-foreground">Checking the application…</p>}
    {problem && <><Alert variant="destructive"><AlertDescription>{problem} Start the connection again if it has expired.</AlertDescription></Alert><Button variant="outline" disabled={pending} onClick={() => void load()}>Try again</Button></>}
  </div>;
}
