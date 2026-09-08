"use client";
import { useActionState, useEffect, useId, useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import { Input } from "@counted/ui/components/input";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@counted/ui/components/alert";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@counted/ui/components/dialog";
import {
  issueCredential,
  rotateCredential,
  type IssueState,
  type RotateState,
} from "../actions/credentials";
import { shareDashboard, type SharingOutcome } from "../actions/share";
import { unshareDashboard } from "../actions/dashboards";
import type { ContractOutputs } from "../lib/client";
import { FailureNotice } from "./notice";
import { SubmitButton } from "./submit";
import { SelectControl } from "./select-control";
import { Field, Fields, FormActions } from "./form";
import { instant } from "../lib/format";
import { CreationPending } from "./creation-dialog";

/** One-time secrets stay in React state; never a URL, persistent storage, or a log. */
function Once({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <Alert className="mt-6">
      <AlertTitle>{label}</AlertTitle>
      <AlertDescription className="space-y-4">
        <code className="block whitespace-pre-wrap break-all font-mono text-xs text-foreground">
          {value}
        </code>
        <p>{note}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
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
        {failed && (
          <p role="status">
            Copy is unavailable. Select the value above to copy it.
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
export function IssueKeyForm({
  projectId,
  returnTo,
  canIssueService,
  onIssued,
}: {
  projectId: string;
  returnTo: string;
  canIssueService: boolean;
  onIssued?: (secret: string) => void;
}) {
  const id = useId();
  const [state, action, pending] = useActionState<IssueState, FormData>(
    issueCredential,
    { status: "idle" },
  );
  useEffect(() => {
    if (state.status === "issued") onIssued?.(state.issued.secret);
  }, [state, onIssued]);
  return (
    <>
      {state.status !== "issued" && (
        <form action={action}>
          <CreationPending />
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Fields>
            <Field label="Name" htmlFor={`${id}-name`}>
              <Input
                id={`${id}-name`}
                name="name"
                required
                maxLength={200}
                placeholder="Production web"
              />
            </Field>
            <Field label="Kind" htmlFor={`${id}-kind`}>
              <SelectControl
                id={`${id}-kind`}
                name="kind"
                defaultValue="ingest"
                items={[
                  { value: "ingest", label: "Ingest — sends events" },
                  ...(canIssueService
                    ? [
                        {
                          value: "service",
                          label: "Service — reads and manages",
                        },
                      ]
                    : []),
                ]}
              />
            </Field>
            <Field
              label="Expires in"
              htmlFor={`${id}-expiry`}
              hint="Days. Leave blank for no expiry."
            >
              <Input
                id={`${id}-expiry`}
                name="expiresInDays"
                type="number"
                min={1}
                max={3650}
                placeholder="No expiry"
              />
            </Field>
          </Fields>
          <div className="mt-7 flex items-center justify-between gap-3 border-t pt-5">
            <DialogClose render={<Button type="button" variant="ghost" />}>
              Cancel
            </DialogClose>
            <SubmitButton pendingLabel="Issuing…">Issue key</SubmitButton>
          </div>
        </form>
      )}
      {state.status === "failed" && <FailureNotice failure={state.failure} />}
      {state.status === "issued" && (
        <Once
          key={state.issued.credential.id}
          label={`Secret for ${state.issued.credential.name}`}
          value={state.issued.secret}
          note="Copy this key before closing. It won’t be shown again."
        />
      )}
    </>
  );
}
export function RotateKeyButton({
  projectId,
  credentialId,
  returnTo,
  disabled = false,
}: {
  projectId: string;
  credentialId: string;
  returnTo: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [state, action] = useActionState<RotateState, FormData>(
    rotateCredential,
    { status: "idle" },
  );
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="outline" size="sm" />}
        disabled={disabled}
      >
        Rotate
      </DialogTrigger>
      <DialogContent className="app-content">
        <DialogHeader>
          <DialogTitle>
            {state.status === "rotated" ? "Key rotated" : "Rotate key"}
          </DialogTitle>
          <DialogDescription>
            {state.status === "rotated"
              ? "Copy the replacement key before closing this dialog."
              : "Issue a replacement while keeping the old key working for a grace period."}
          </DialogDescription>
        </DialogHeader>
        {state.status !== "rotated" && (
          <form action={action}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="credentialId" value={credentialId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Field
              label="Grace period (days)"
              htmlFor={`${id}-overlap`}
              hint="Use zero to retire the old key immediately."
            >
              <Input
                id={`${id}-overlap`}
                name="overlapDays"
                type="number"
                min={0}
                max={90}
                defaultValue={7}
              />
            </Field>
            <FormActions>
              <SubmitButton variant="outline" pendingLabel="Rotating…">
                Rotate key
              </SubmitButton>
            </FormActions>
          </form>
        )}
        {state.status === "failed" && <FailureNotice failure={state.failure} />}
        {state.status === "rotated" && (
          <Once
            label={`New secret for ${state.rotated.issued.credential.name}`}
            value={state.rotated.issued.secret}
            note={
              state.rotated.retiring.status === "expired" ||
              state.rotated.retiring.expiresAt === null
                ? "Shown once. The previous key has been retired."
                : `Shown once. The previous key keeps working until ${instant(state.rotated.retiring.expiresAt)} UTC.`
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
export function ShareControls({
  dashboardId,
  returnTo,
  origin,
  share,
}: {
  dashboardId: string;
  returnTo: string;
  origin: string;
  share: ContractOutputs["dashboards"]["get"]["dashboard"]["share"];
}) {
  const id = useId();
  const [state, action] = useActionState<SharingOutcome, FormData>(
    shareDashboard,
    { status: "idle" },
  );
  return (
    <>
      {share === null ? (
        <form action={action} className="max-w-sm">
          <input type="hidden" name="dashboardId" value={dashboardId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Field label="Link lasts (days)" htmlFor={`${id}-expires`}>
            <Input
              id={`${id}-expires`}
              name="expiresInDays"
              type="number"
              min={1}
              max={365}
              defaultValue={30}
            />
          </Field>
          <FormActions>
            <SubmitButton pendingLabel="Creating…">
              Create share link
            </SubmitButton>
          </FormActions>
        </form>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-muted-foreground">
            A read-only link is live until {instant(share.expiresAt)} UTC.
            {state.status !== "shared" &&
              " The link is shown once at creation. Revoke it and create another if you need a new copy."}
          </p>
          <form action={unshareDashboard}>
            <input type="hidden" name="dashboardId" value={dashboardId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <FormActions>
              <SubmitButton
                pendingLabel="Revoking…"
                confirm="Revoke the share link? Anyone holding the URL loses access immediately."
                variant="outline"
              >
                Revoke share link
              </SubmitButton>
            </FormActions>
          </form>
        </>
      )}
      {state.status === "failed" && <FailureNotice failure={state.failure} />}
      {share !== null && state.status === "shared" && (
        <Once
          label="Share link"
          value={`${origin}/share/${state.link.token}`}
          note={`Copy this link before leaving. It expires ${instant(state.link.expiresAt)} UTC. Counted stores only its digest.`}
        />
      )}
    </>
  );
}
