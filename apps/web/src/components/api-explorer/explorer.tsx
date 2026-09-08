"use client";

import { useEffect, useRef, useState } from "react";
import {
  apiDocument,
  operationGroupsOf,
  initialValue,
  parameterSchema,
  requestSchema,
  resolveSchema,
  buildRequest,
  buildCustomRequest,
  type RequestCredential,
  type Json,
  type Operation,
} from "@counted/openapi";
import { Button } from "@counted/ui/components/button";
import { Badge } from "@counted/ui/components/badge";
import { Input } from "@counted/ui/components/input";
import { Label } from "@counted/ui/components/label";
import { Alert, AlertDescription } from "@counted/ui/components/alert";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@counted/ui/components/tabs";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxList,
  ComboboxItem,
} from "@counted/ui/components/combobox";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@counted/ui/components/alert-dialog";
import {
  IconArrowUpRight,
  IconCheck,
  IconCopy,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { SelectControl } from "../select-control";
import { SchemaField, JsonEditor } from "./schema-field";

const resources = operationGroupsOf(apiDocument);
const resourceLabels: Record<string, string> = {
  credentials: "API keys",
  share: "Shared dashboards",
};
const resourceOptions = resources.map(({ name }) => ({
  value: name,
  label: resourceLabels[name] ?? name.charAt(0).toUpperCase() + name.slice(1),
}));
const optionLabel = (operation: Operation) =>
  `${operation.summary} · ${operation.operationId}`;
const authLabels: Record<string, string> = {
  consoleSession: "Signed-in session",
  serviceKey: "Service key",
  ingestKey: "Ingest key",
  ingestBeacon: "Ingest key · beacon query",
  shareToken: "Share token",
  none: "No authentication",
};
type Result = {
  status: number;
  ok: boolean;
  statusText: string;
  duration: number;
  body: string;
  headers: string;
  request: string;
};
type Prepared = ReturnType<typeof buildRequest>;
const customOperation: Operation = {
  operationId: "custom",
  method: "POST",
  path: "/v1/events",
  summary: "Custom request",
  description:
    "Call authentication routes or send a request you already know how to build. Event ingestion also has a generated form under Events.",
  parameters: [],
  security: [
    { ingestKey: [] },
    { serviceKey: [] },
    { consoleSession: [] },
    { none: [] },
  ],
  requestBody: {
    content: {
      "application/json": {
        schema: { type: "object", additionalProperties: true },
      },
    },
  },
};

export function ApiExplorer({ workspaceId }: { workspaceId: string }) {
  const [operation, setOperation] = useState(() =>
    resources
      .flatMap((resource) => resource.operations)
      .find((item) => item.operationId === "workspaces.get")!,
  );
  const resource = resources.find((resource) =>
    resource.operations.some(
      (item) => item.operationId === operation.operationId,
    ),
  )!;
  const operations = resource.operations;
  const optionLabels = operations.map(optionLabel);
  const [mode, setMode] = useState("reference");
  return (
    <Tabs
      value={mode}
      onValueChange={(value) => setMode(String(value))}
      className="min-w-0 gap-7"
    >
      <TabsList aria-label="Request source">
        <TabsTrigger value="reference">From the reference</TabsTrigger>
        <TabsTrigger value="custom">Custom request</TabsTrigger>
      </TabsList>
      <TabsContent value="reference" className="min-w-0 space-y-7">
        <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor="api-resource">Resource</Label>
            <SelectControl
              id="api-resource"
              items={resourceOptions}
              value={resource.name}
              onValueChange={(name) => {
                const next = resources.find(
                  (resource) => resource.name === name,
                );
                if (next && next !== resource) {
                  setOperation(
                    next.operations.find(
                      (operation) => operation.method === "GET",
                    ) ?? next.operations[0]!,
                  );
                }
              }}
            />
          </div>
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor="api-operation">
              Operation{" "}
              <span className="font-normal text-muted-foreground">
                {operations.length} available
              </span>
            </Label>
            <Combobox
              key={resource.name}
              items={optionLabels}
              value={optionLabel(operation)}
              onValueChange={(next) => {
                const selected = operations.find(
                  (item) => optionLabel(item) === next,
                );
                if (selected) setOperation(selected);
              }}
            >
              <ComboboxInput
                id="api-operation"
                placeholder="Search operations…"
                className="w-full"
              />
              <ComboboxContent>
                <ComboboxEmpty>No matching operations.</ComboboxEmpty>
                <ComboboxList>
                  {(item: string) => {
                    const match = operations.find(
                      (operation) => optionLabel(operation) === item,
                    )!;
                    return (
                      <ComboboxItem
                        key={item}
                        value={item}
                        className="items-start py-3"
                      >
                        <Badge
                          variant="outline"
                          className="mt-0.5 w-16 shrink-0 justify-center font-mono text-[10px]"
                        >
                          {match.method}
                        </Badge>
                        <span className="min-w-0">
                          <span className="block [overflow-wrap:anywhere]">
                            {match.summary}
                          </span>
                          <span className="mt-1 block font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                            {match.path}
                          </span>
                        </span>
                      </ComboboxItem>
                    );
                  }}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
        </div>
        <OperationEditor
          key={`${workspaceId}:${operation.operationId}`}
          operation={operation}
          workspaceId={workspaceId}
        />
      </TabsContent>
      <TabsContent value="custom" className="min-w-0">
        <OperationEditor
          key="custom"
          operation={customOperation}
          workspaceId={workspaceId}
          custom
        />
      </TabsContent>
    </Tabs>
  );
}

function OperationEditor({
  operation: template,
  workspaceId,
  custom = false,
}: {
  operation: Operation;
  workspaceId: string;
  custom?: boolean;
}) {
  const [customPath, setCustomPath] = useState(template.path);
  const [customMethod, setCustomMethod] = useState(template.method);
  const operation = custom
    ? { ...template, path: customPath, method: customMethod }
    : template;
  const rawSchema = requestSchema(operation);
  const resolved = rawSchema
    ? resolveSchema(apiDocument, rawSchema)
    : undefined;
  const emptyOptionalBody =
    !custom &&
    !operation.requestBody?.required &&
    resolved?.type === "object" &&
    resolved.properties &&
    Object.keys(resolved.properties).length === 0;
  const schema =
    (custom && ["GET", "HEAD"].includes(customMethod)) || emptyOptionalBody
      ? undefined
      : rawSchema;
  const [parameters, setParameters] = useState<
    Record<string, Json | undefined>
  >(() =>
    Object.fromEntries(
      operation.parameters.map((parameter) => [
        `${parameter.in}:${parameter.name}`,
        parameter.name === "workspaceId"
          ? workspaceId
          : parameter.required
            ? initialValue(apiDocument, parameterSchema(parameter))
            : undefined,
      ]),
    ),
  );
  const [body, setBody] = useState<Json | undefined>(() =>
    schema && (custom || operation.requestBody?.required)
      ? initialValue(apiDocument, schema, { workspaceId, ...(operation.operationId === "events.ingest" ? {
          events: [{ name: "page_view", visitId: crypto.randomUUID(), occurredAt: new Date().toISOString(),
            idempotencyKey: crypto.randomUUID(), properties: { url: "/pricing", source: "api_explorer" } }],
        } : {}) })
      : undefined,
  );
  const [bodyMode, setBodyMode] = useState(custom ? "json" : "form");
  const [jsonError, setJsonError] = useState<string>();
  const schemes = [
    ...new Set(
      (operation.security ?? apiDocument.security ?? []).flatMap(
        (requirement) => Object.keys(requirement),
      ),
    ),
  ];
  if (!schemes.length) schemes.push("none");
  const [auth, setAuth] = useState(
    custom
      ? "ingestKey"
      : schemes.includes("consoleSession")
        ? "consoleSession"
        : schemes[0]!,
  );
  const [token, setToken] = useState("");
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Prepared>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  function credential(): RequestCredential {
    if (auth === "consoleSession") return { kind: "session" };
    const scheme = apiDocument.components?.securitySchemes?.[auth];
    if (scheme?.type === "http") return { kind: "bearer", token };
    if (scheme?.type === "apiKey" && scheme.in === "query" && auth !== "shareToken") {
      if (!token.trim()) throw new Error("Enter an ingest key.");
      return { kind: "query", name: scheme.name!, token: token.trim() };
    }
    // Share tokens are already generated as required query parameter controls.
    return { kind: "none" };
  }
  async function send(request: Prepared) {
    setPending(undefined);
    setError(undefined);
    setResult(undefined);
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    const started = performance.now();
    const timeout = setTimeout(() => abort.abort("timeout"), 60_000);
    try {
      const response = await fetch(request.url, {
        ...request.init,
        signal: abort.signal,
      });
      const raw = await response.text();
      let text = raw;
      try {
        text = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        /* Plain-text errors remain readable. */
      }
      setResult({
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        duration: Math.round(performance.now() - started),
        body: text,
        headers: [...response.headers]
          .map(([name, value]) => `${name}: ${value}`)
          .join("\n"),
        request: `${request.init.method} ${request.url.replace(/^\/api(?=\/v1\/)/, "").split("?")[0]}`,
      });
    } catch {
      setError(
        abort.signal.aborted
          ? abort.signal.reason === "timeout"
            ? "The request timed out after 60 seconds. A write may still have completed; check its resource before retrying."
            : "Request cancelled. A write may still have completed."
          : "Couldn’t reach the API. Check your connection and try again.",
      );
    } finally {
      clearTimeout(timeout);
      if (controller.current === abort) controller.current = null;
      setBusy(false);
    }
  }
  const keyAuth =
    apiDocument.components?.securitySchemes?.[auth]?.type === "http" || auth === "ingestBeacon";
  return (
    <div className="@container/explorer min-w-0 space-y-6">
      <header className="space-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Badge variant="outline" className="font-mono">
            {operation.method}
          </Badge>
          <code className="min-w-0 text-sm [overflow-wrap:anywhere]">
            {operation.path}
          </code>
        </div>
        <h2 className="font-heading text-xl">{operation.summary}</h2>
        {operation.description && (
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {operation.description}
          </p>
        )}
      </header>
      <div className="grid min-w-0 items-start gap-6 @min-[900px]/explorer:grid-cols-2">
        <form
          className="min-w-0 border"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            setError(undefined);
            try {
              if (jsonError && schema) throw new Error(jsonError);
              const request = custom
                ? buildCustomRequest(
                    customPath,
                    customMethod,
                    schema ? body : undefined,
                    credential(),
                  )
                : buildRequest(
                    apiDocument,
                    operation,
                    parameters,
                    body,
                    credential(),
                  );
              if (operation.method === "DELETE") setPending(request);
              else void send(request);
            } catch (failure) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : "Check the request fields.",
              );
            }
          }}
        >
          <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-5 py-4">
            <h3 className="font-medium">Request</h3>
            <span className="text-xs text-muted-foreground">
              {operation.operationId}
            </span>
          </div>
          <div className="space-y-6 p-5 sm:p-6">
            {custom && (
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="custom-method">Method</Label>
                  <SelectControl
                    id="custom-method"
                    value={customMethod}
                    items={[
                      "GET",
                      "POST",
                      "PUT",
                      "PATCH",
                      "DELETE",
                      "HEAD",
                      "OPTIONS",
                    ].map((value) => ({ value, label: value }))}
                    onValueChange={setCustomMethod}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="custom-path">API path</Label>
                  <Input
                    id="custom-path"
                    value={customPath}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => setCustomPath(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use /v1/ or /api/auth/. Include query parameters in the
                    path.
                  </p>
                </div>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="api-auth">Authentication</Label>
              <SelectControl
                id="api-auth"
                value={auth}
                items={schemes.map((name) => ({
                  value: name,
                  label: authLabels[name] ?? name,
                }))}
                onValueChange={(next) => {
                  setAuth(next);
                  setToken("");
                }}
              />
              {keyAuth ? (
                <>
                  <Input
                    aria-label={authLabels[auth]}
                    type="password"
                    autoComplete="off"
                    placeholder={auth === "ingestKey" || auth === "ingestBeacon" ? "ck_…" : "sk_…"}
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                  />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Kept in memory for this operation. Never saved in your
                    browser.
                  </p>
                </>
              ) : (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {auth === "consoleSession"
                    ? "Uses your account’s existing permissions."
                    : auth === "shareToken"
                      ? "Enter the dashboard’s share token below."
                      : "This operation is public."}
                </p>
              )}
            </div>
            {operation.parameters.length > 0 && (
              <fieldset className="min-w-0 space-y-5 border-t pt-5">
                <legend className="px-1 text-xs font-medium text-muted-foreground">
                  Parameters
                </legend>
                {operation.parameters.map((parameter) => (
                  <SchemaField
                    key={`${parameter.in}:${parameter.name}`}
                    document={apiDocument}
                    schema={{
                      ...parameterSchema(parameter),
                      ...(parameter.description
                        ? { description: parameter.description }
                        : {}),
                    }}
                    value={parameters[`${parameter.in}:${parameter.name}`]}
                    label={parameter.name}
                    required={parameter.required ?? false}
                    onChange={(value) =>
                      setParameters((current) => ({
                        ...current,
                        [`${parameter.in}:${parameter.name}`]: value,
                      }))
                    }
                  />
                ))}
              </fieldset>
            )}
            {schema && (
              <Tabs
                value={bodyMode}
                onValueChange={(next) => {
                  setBodyMode(String(next));
                  if (next === "form") setJsonError(undefined);
                }}
                className="min-w-0 gap-5 border-t pt-5"
              >
                <TabsList aria-label="Request body editor">
                  <TabsTrigger value="form">Form</TabsTrigger>
                  <TabsTrigger value="json">JSON</TabsTrigger>
                </TabsList>
                <TabsContent value="form">
                  <SchemaField
                    document={apiDocument}
                    schema={schema}
                    value={body}
                    label="Request body"
                    required={operation.requestBody?.required ?? false}
                    onChange={setBody}
                  />
                </TabsContent>
                <TabsContent value="json">
                  <JsonEditor
                    key={bodyMode}
                    label="Request body JSON"
                    value={body}
                    onChange={setBody}
                    onInvalid={setJsonError}
                  />
                </TabsContent>
              </Tabs>
            )}
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription className="[overflow-wrap:anywhere]">
                  {error}
                </AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t pt-5">
              <Button
                type="submit"
                disabled={busy}
                variant={
                  operation.method === "DELETE" ? "destructive" : "default"
                }
              >
                <IconPlayerPlay />
                {busy ? "Sending…" : "Send request"}
              </Button>
              {busy && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => controller.current?.abort()}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </form>
        <section
          aria-label="API response"
          aria-busy={busy}
          className="min-w-0 border"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-5 py-4">
            <h3 className="font-medium">Response</h3>
            <div aria-live="polite" className="flex items-center gap-3 text-xs">
              {result && (
                <>
                  <Badge variant={result.ok ? "secondary" : "destructive"}>
                    {result.status} {result.statusText}
                  </Badge>
                  <span className="text-muted-foreground">
                    {result.duration.toLocaleString()} ms
                  </span>
                </>
              )}
              {busy && (
                <span className="text-muted-foreground">
                  Waiting for the API…
                </span>
              )}
            </div>
          </div>
          {result && (
            <p className="px-5 pt-4 text-xs text-muted-foreground [overflow-wrap:anywhere] sm:px-6">
              Last request <code>{result.request}</code>
            </p>
          )}
          <Tabs defaultValue="body" className="min-w-0 gap-4 p-5 sm:p-6">
            <TabsList aria-label="Response view" className="max-w-full">
              <TabsTrigger value="body">Body</TabsTrigger>
              <TabsTrigger value="headers">Headers</TabsTrigger>
              {!custom && <TabsTrigger value="schema">Schema</TabsTrigger>}
            </TabsList>
            <TabsContent value="body">
              {result ? (
                <CodeBlock
                  label="Response body"
                  text={result.body || "(empty response)"}
                />
              ) : (
                <div className="flex min-h-44 flex-col justify-center gap-2 py-5">
                  <p className="font-heading text-lg">Ready when you are</p>
                  <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
                    Choose an operation, fill in its fields, and send a request
                    to see the response.
                  </p>
                </div>
              )}
            </TabsContent>
            <TabsContent value="headers">
              {result ? (
                <CodeBlock label="Response headers" text={result.headers} />
              ) : (
                <p className="py-8 text-sm text-muted-foreground">
                  Headers will appear after a request.
                </p>
              )}
            </TabsContent>
            <TabsContent value="schema">
              <CodeBlock
                label="Response schemas"
                text={JSON.stringify(operation.responses ?? {}, null, 2)}
              />
            </TabsContent>
          </Tabs>
        </section>
      </div>
      <p className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span>Requests run against the same API as this app.</span>
        <a
          href="https://docs.counted.dev"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary-ink underline underline-offset-4"
        >
          API reference <IconArrowUpRight className="size-3" />
        </a>
      </p>
      <AlertDialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) setPending(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this delete request?</AlertDialogTitle>
            <AlertDialogDescription>
              {operation.summary}. This applies to the resource identified in
              your request.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <code className="text-xs [overflow-wrap:anywhere]">
            {pending?.url.replace(/^\/api/, "")}
          </code>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pending) void send(pending);
              }}
            >
              Send delete request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CodeBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setCopied(false);
    setFailed(false);
  }, [text]);
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setFailed(false);
            } catch {
              setFailed(true);
            }
          }}
        >
          {copied ? <IconCheck /> : <IconCopy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {failed && (
        <p role="status" className="text-xs text-muted-foreground">
          Couldn’t copy. Select the text below to copy it.
        </p>
      )}
      <pre
        aria-label={label}
        tabIndex={0}
        className="max-h-[36rem] max-w-full overflow-auto border bg-muted/30 p-4 font-mono text-xs leading-6"
      >
        <code>{text}</code>
      </pre>
    </div>
  );
}
