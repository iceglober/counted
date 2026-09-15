"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@counted/ui/components/button";
import { Input } from "@counted/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@counted/ui/components/table";
import { Alert, AlertDescription } from "@counted/ui/components/alert";
import { CreationDialog } from "./creation-dialog";
import { IssueKeyForm } from "./secret";
import { Disclosure, Region } from "./layout";
import { Field } from "./form";
import { SelectControl } from "./select-control";
import { useSetupKey } from "./setup-key";
import { projectActivity } from "../actions/catalog";
import { setupExample } from "../lib/setup-example";
import { failureOf, sentenceFor } from "../lib/failure";

function LiveEvents({
  projectId,
  workspaceId,
  archived,
}: {
  projectId: string;
  workspaceId: string;
  archived: boolean;
}) {
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof projectActivity>
  > | null>(null);
  useEffect(() => {
    let canceled = false;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      if (canceled || busy || document.hidden) return;
      clearTimeout(timer);
      busy = true;
      try {
        const next = await projectActivity(projectId);
        if (!canceled) setResult(next);
      } catch (error) {
        if (!canceled) setResult({ ok: false, failure: failureOf(error) });
      } finally {
        busy = false;
        if (!canceled && !archived) timer = setTimeout(refresh, 5000);
      }
    }
    void refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      canceled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [projectId, archived]);
  const value = result?.ok ? result.value.readout.value : null;
  const rows = value?.shape === "breakdown" ? value.rows : [];
  return (
    <Region title="Live events" meta="Last 24 hours · top 20 events">
      <div aria-live="polite" aria-atomic="true">
        {!result && (
          <p className="text-sm text-muted-foreground">Checking for events…</p>
        )}
        {result && !result.ok && (
          <Alert variant="destructive">
            <AlertDescription>
              {sentenceFor(result.failure)}{" "}
              {!archived && "Checking again automatically."}
            </AlertDescription>
          </Alert>
        )}
        {result?.ok && (
          <p className="text-sm text-muted-foreground">
            {rows.length
              ? "Connected. Events are arriving from your app."
              : archived
              ? "No events in the last 24 hours."
              : "Waiting for your first event. Run the code above; this updates automatically."}
          </p>
        )}
      </div>
      {rows.length > 0 && (
        <>
          <Table aria-label="Live event counts">
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead className="text-right">Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="font-mono text-xs break-all whitespace-normal">
                    {row.label}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.value.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button
            nativeButton={false}
            render={<Link href={`/w/${workspaceId}/dashboards`} />}
            variant="outline"
            size="sm"
          >
            Build an Insight
          </Button>
        </>
      )}
    </Region>
  );
}

export function ProjectSetup({
  projectId,
  workspaceId,
  endpoint,
  canWrite,
  archived,
}: {
  projectId: string;
  workspaceId: string;
  endpoint: string;
  canWrite: boolean;
  archived: boolean;
}) {
  const prepared = useSetupKey();
  const [key, setKey] = useState<string | null>(null);
  const [language, setLanguage] = useState("js");
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const token = key ?? prepared.key;
  const base = `/w/${workspaceId}/projects/${projectId}`;
  const snippet = setupExample(language, endpoint, token || "YOUR_INGEST_KEY");
  return (
    <div className="grid min-w-0 items-start gap-9 xl:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
      <div className="min-w-0">
        {archived ? (
          <p className="text-sm text-muted-foreground">
            This project is archived. Restore it in Settings before connecting
            an app.
          </p>
        ) : (
          <Region title="Connect your app">
            <div className="max-w-2xl space-y-5">
              <p className="text-sm text-muted-foreground">
                Install the SDK once, then track an action. Batching, retries,
                and temporary visits are handled for you.
              </p>
              {!prepared.key && (
                <div className="space-y-3">
                  <p className="text-sm">
                    {canWrite
                      ? "Your key is shown only when created. Create a new ingest key or use one you saved."
                      : "Ask an owner or admin for an ingest key, then paste it below."}
                  </p>
                  {canWrite && (
                    <CreationDialog title="New ingest key">
                      <IssueKeyForm
                        projectId={projectId}
                        returnTo={base}
                        canIssueService={false}
                        onIssued={setKey}
                      />
                    </CreationDialog>
                  )}
                  <Field label="Ingest key" htmlFor="setup-key">
                    <Input
                      id="setup-key"
                      type="password"
                      value={token}
                      onChange={(event) => {
                        setKey(event.target.value);
                        setCopy("idle");
                      }}
                      autoComplete="off"
                      placeholder="Paste an existing ingest key"
                    />
                  </Field>
                </div>
              )}
              <div className="max-w-xs">
                <Field label="Environment" htmlFor="setup-language">
                  <SelectControl
                    id="setup-language"
                    value={language}
                    onValueChange={(value) => {
                      setLanguage(value);
                      setCopy("idle");
                    }}
                    items={[
                      { value: "js", label: "Browser JavaScript" },
                      { value: "node", label: "Node.js / Bun" },
                      { value: "http", label: "HTTP / cURL" },
                    ]}
                  />
                </Field>
              </div>
              {language !== "http" && (
                <pre className="whitespace-pre-wrap break-all">
                  <code>npm install @counted/sdk</code>
                </pre>
              )}
              <pre
                data-testid="setup-code"
                className="whitespace-pre-wrap break-all"
              >
                <code>{snippet}</code>
              </pre>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!token}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(snippet);
                      setCopy("copied");
                    } catch {
                      setCopy("failed");
                    }
                  }}
                >
                  {copy === "copied" ? "Copied" : "Copy code"}
                </Button>
                {token && (
                  <span className="text-xs text-muted-foreground">
                    Ingest only · safe to embed in your app
                  </span>
                )}
              </div>
              {copy === "failed" && (
                <p role="status" className="text-sm">
                  Select the example above to copy it.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Create one client per app. Use event names and properties
                without personal data. No analytics cookies or persistent device
                IDs.
              </p>
              <Disclosure summary="Keys and other SDKs">
                <p className="text-sm text-muted-foreground">
                  Copy this code before leaving. The key stays in memory on this
                  page; Counted cannot show it again. Manage access in{" "}
                  <Link
                    href={`${base}/keys`}
                    className="text-primary-ink underline underline-offset-4"
                  >
                    Keys
                  </Link>
                  .
                </p>
                {token && (
                  <Field
                    label="Use another ingest key"
                    htmlFor="setup-replace-key"
                  >
                    <Input
                      id="setup-replace-key"
                      type="password"
                      value={token}
                      onChange={(event) => {
                        setKey(event.target.value);
                        setCopy("idle");
                      }}
                      autoComplete="off"
                    />
                  </Field>
                )}
                <a
                  href="https://docs.counted.dev/getting-started"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary-ink underline underline-offset-4"
                >
                  React, Python, Go, Rust, and API documentation
                </a>
              </Disclosure>
            </div>
          </Region>
        )}
      </div>
      <div className="min-w-0">
        <LiveEvents
          key={projectId}
          projectId={projectId}
          workspaceId={workspaceId}
          archived={archived}
        />
      </div>
    </div>
  );
}
