"use client";

import Link from "next/link";
import { setupExample } from "../lib/setup-example";
import { useState } from "react";
import { Button } from "@counted/ui/components/button";
import { Input } from "@counted/ui/components/input";
import { Badge } from "@counted/ui/components/badge";
import { CreationDialog } from "./creation-dialog";
import { IssueKeyForm } from "./secret";
import { Region } from "./layout";
import { CatalogStatus, useProjectCatalog } from "./event-picker";
import { Field } from "./form";
import { SelectControl } from "./select-control";

export function ProjectSetup({ projectId, workspaceId, endpoint, canWrite, archived }: {
  projectId: string; workspaceId: string; endpoint: string; canWrite: boolean; archived: boolean;
}) {
  const catalog = useProjectCatalog(projectId);
  const [key, setKey] = useState("");
  const [language, setLanguage] = useState("http");
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const token = key || "YOUR_INGEST_KEY";
  const events = catalog.catalog?.events ?? [];
  const base = `/w/${workspaceId}/projects/${projectId}`;
  const snippet = setupExample(language, endpoint, token);
  return <>
    <Region title={events.length ? "Receiving events" : "Connect your app"}>
      <CatalogStatus state={catalog} />
      {catalog.catalog && <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{events.length ? "Recent event names available for Insights." : "Send your first event, then check for it here."}</p>
        {events.length > 0 && <div className="flex flex-wrap gap-2">{events.slice(0, 20).map(name => <Badge key={name} variant="secondary">{name}</Badge>)}</div>}
        <div className="flex flex-wrap gap-3"><Button variant="outline" size="sm" onClick={catalog.retry}>Check for events</Button>
          {events.length > 0 && <Button nativeButton={false} render={<Link href={`/w/${workspaceId}/dashboards`} />} size="sm">Build an Insight</Button>}
        </div>
      </div>}
    </Region>
    {archived ? <p className="text-sm text-muted-foreground">This project is archived. Restore it in Settings before connecting an app.</p> : <Region title="Installation">
      <div className="max-w-xl space-y-6">
        {canWrite ? <div className="space-y-3"><p className="text-sm">Create an ingest key or paste an existing one to prepare the example. Ingest keys only send events.</p>
          <CreationDialog title="New ingest key"><IssueKeyForm projectId={projectId} returnTo={base} canIssueService={false} onIssued={setKey} /></CreationDialog>
          <Field label="Ingest key" htmlFor="setup-key" hint="Used only in this page’s example. It is not saved in browser storage."><Input id="setup-key" type="password" value={key} onChange={event => { setKey(event.target.value); setCopy("idle"); }} autoComplete="off" placeholder="Paste an existing ingest key" /></Field>
        </div> : <p className="text-sm text-muted-foreground">Ask an owner or admin for an ingest key to connect your app.</p>}
        <Field label="Example" htmlFor="setup-language"><SelectControl id="setup-language" value={language} onValueChange={value => { setLanguage(value); setCopy("idle"); }} items={[{ value: "http", label: "HTTP / cURL" }, { value: "js", label: "JavaScript" }]} /></Field>
        {language === "js" && <code className="block text-sm">npm install @counted/sdk</code>}
        <pre className="whitespace-pre-wrap break-all"><code>{snippet}</code></pre>
        <Button variant="outline" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(snippet); setCopy("copied"); } catch { setCopy("failed"); } }}>{copy === "copied" ? "Copied" : "Copy example"}</Button>
        {copy === "failed" && <p role="status" className="text-sm">Select the example above to copy it.</p>}
        <p className="text-xs text-muted-foreground">Use route paths without personal data, query strings, or URL fragments. Visit ids group activity temporarily; they are not user identities.</p>
        <a href="https://docs.counted.dev" target="_blank" rel="noreferrer" className="text-sm text-primary-ink underline underline-offset-4">SDKs and API documentation</a>
      </div>
    </Region>}
  </>;
}
