"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@counted/ui/components/button";
import { Input } from "@counted/ui/components/input";
import { Alert, AlertDescription } from "@counted/ui/components/alert";
import { Field } from "./form";
import { SelectControl } from "./select-control";
import { CreationDialog, CreationForm } from "./creation-dialog";
import { claimProject, createClaimWorkspace } from "../actions/claim";
import { failureOf, isUnauthenticated, sentenceFor, type Failure } from "../lib/failure";
import type { ContractOutputs } from "../lib/client";

type Workspace = ContractOutputs["account"]["me"]["workspaces"][number];
export function ClaimProject({workspaces}: {workspaces: Workspace[]}) {
  const id = useId();
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [projectId, setProjectId] = useState("");
  const [claimToken, setClaimToken] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const destination = workspaces.some((one) => one.id === workspaceId) ? workspaceId : workspaces[0]?.id ?? "";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setFailure(null);
    try {
      const result = await claimProject({workspaceId: destination, projectId: projectId.trim(), claimToken: claimToken.trim()});
      if (!result.ok) { setFailure(result.failure); return; }
      setClaimToken("");
      router.push(`/w/${encodeURIComponent(destination)}/projects/${encodeURIComponent(result.value.project.id)}`);
      router.refresh();
    } catch (cause) { setFailure(failureOf(cause)); }
    finally { setPending(false); }
  }
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{workspaces.length ? "Choose where this project belongs." : "Create a workspace before claiming your project."}</p><CreationDialog title="Create a workspace" trigger="New workspace"><CreationForm action={createClaimWorkspace} submitLabel="Create workspace"><Field label="Workspace name" htmlFor={`${id}-workspace-name`}><Input id={`${id}-workspace-name`} name="name" maxLength={200} required /></Field></CreationForm></CreationDialog></div>
    {!!workspaces.length && <form onSubmit={submit} className="space-y-5" aria-busy={pending}>
      <fieldset disabled={pending} className="min-w-0 space-y-5">
        <Field label="Workspace" htmlFor={`${id}-workspace`}><SelectControl id={`${id}-workspace`} value={destination} onValueChange={(value) => setWorkspaceId(value ?? "")} items={workspaces.map((one) => ({value: one.id, label: one.name}))} /></Field>
        <Field label="Project ID" htmlFor={`${id}-project`}><Input id={`${id}-project`} value={projectId} onChange={(event) => setProjectId(event.target.value)} required autoComplete="off" spellCheck={false} /></Field>
        <Field label="Claim token" htmlFor={`${id}-token`} hint="Paste the claim token returned when you provisioned the project. It is kept only in this page while you claim it."><Input id={`${id}-token`} type="password" value={claimToken} onChange={(event) => setClaimToken(event.target.value)} required autoComplete="off" spellCheck={false} /></Field>
      </fieldset>
      {failure && <Alert variant="destructive"><AlertDescription>{sentenceFor(failure)}{isUnauthenticated(failure) && <> <Link href="/sign-in?next=%2Fclaim" className="underline">Sign in again</Link>, then paste your claim token.</>}</AlertDescription></Alert>}
      <Button type="submit" disabled={pending || !destination}>{pending ? "Claiming…" : "Claim project"}</Button>
    </form>}
  </div>;
}
