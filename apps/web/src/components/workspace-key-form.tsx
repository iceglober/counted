"use client";

import { useActionState, useId, useState } from "react";
import type { ContractOutputs } from "../lib/client";
import { Button } from "@counted/ui/components/button";
import { Input } from "@counted/ui/components/input";
import { DialogClose } from "@counted/ui/components/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@counted/ui/components/select";
import {
  issueWorkspaceCredential,
  rotateWorkspaceCredential,
  type IssueState,
  type RotateState,
} from "../actions/credentials";
import { Field, Fields, FormActions } from "./form";
import { CreationPending } from "./creation-dialog";
import { FailureNotice } from "./notice";
import { SubmitButton } from "./submit";
import { Once } from "./secret";
import { instant } from "../lib/format";
import { permissionLabel } from "../lib/credential-labels";

type Permission =
  ContractOutputs["credentials"]["listForWorkspace"]["grantablePermissions"][number];

export function WorkspaceKeyForm({
  workspaceId,
  returnTo,
  allowed,
}: {
  workspaceId: string;
  returnTo: string;
  allowed: Permission[];
}) {
  const id = useId();
  const [selected, setSelected] = useState<Permission[]>(
    allowed.filter((p) =>
      ["queries:run", "projects:read", "workspace:read"].includes(p)
    )
  );
  const [state, action, pending] = useActionState<IssueState, FormData>(
    issueWorkspaceCredential,
    { status: "idle" }
  );
  if (state.status === "issued")
    return (
      <Once
        label={`Secret for ${state.issued.credential.name}`}
        value={state.issued.secret}
        note="Copy this key before closing. It won’t be shown again. Keep it on your server or in your agent’s secret store, never in browser code."
      />
    );
  return (
    <form action={action}>
      <CreationPending />
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {selected.map((permission) => (
        <input
          key={permission}
          type="hidden"
          name="permissions"
          value={permission}
        />
      ))}
      <fieldset disabled={pending} className="min-w-0">
        <Fields>
          <p className="text-sm text-muted-foreground">
            Access across this workspace and its projects, limited to the
            permissions you select.
          </p>
          <Field label="Name" htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              name="name"
              required
              maxLength={200}
              placeholder="Analytics agent"
            />
          </Field>
          <Field
            label="Permissions"
            htmlFor={`${id}-permissions`}
            hint="Starts with analytics queries and read access to projects and workspace details."
          >
            <Select
              multiple
              items={allowed.map((value) => ({
                value,
                label: permissionLabel(value),
              }))}
              value={selected}
              onValueChange={setSelected}
            >
              <SelectTrigger id={`${id}-permissions`} className="w-full">
                <SelectValue>
                  {selected.length
                    ? `${selected.length} permissions selected`
                    : "Choose permissions"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {allowed.map((permission) => (
                    <SelectItem key={permission} value={permission}>
                      {permissionLabel(permission)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Expires in (days)" htmlFor={`${id}-expiry`}>
            <Input
              id={`${id}-expiry`}
              name="expiresInDays"
              type="number"
              min={1}
              max={3650}
              defaultValue={90}
              required
            />
          </Field>
        </Fields>
        {state.status === "failed" && <FailureNotice failure={state.failure} />}
        <FormActions>
          <DialogClose render={<Button type="button" variant="ghost" />}>
            Cancel
          </DialogClose>
          <SubmitButton
            disabled={selected.length === 0}
            pendingLabel="Issuing…"
          >
            Issue key
          </SubmitButton>
        </FormActions>
      </fieldset>
    </form>
  );
}

export function RotateWorkspaceKeyForm({
  workspaceId,
  credentialId,
  returnTo,
}: {
  workspaceId: string;
  credentialId: string;
  returnTo: string;
}) {
  const id = useId();
  const [state, action, pending] = useActionState<RotateState, FormData>(
    rotateWorkspaceCredential,
    { status: "idle" }
  );
  if (state.status === "rotated")
    return (
      <Once
        label="Replacement secret"
        value={state.rotated.issued.secret}
        note={
          state.rotated.retiring.status === "expired"
            ? "Copy before closing. The previous key has expired."
            : `Copy before closing. The previous key expires ${instant(
                state.rotated.retiring.expiresAt!
              )} UTC.`
        }
      />
    );
  return (
    <form action={action}>
      <CreationPending />
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="credentialId" value={credentialId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <fieldset disabled={pending} className="min-w-0 space-y-5">
        <p className="text-sm text-muted-foreground">
          The replacement keeps the same permissions. Update your integration
          before the old key expires.
        </p>
        <Field
          label="Grace period (days)"
          htmlFor={`${id}-overlap`}
          hint="0 retires the old key immediately. Maximum 7 days."
        >
          <Input
            id={`${id}-overlap`}
            name="overlapDays"
            type="number"
            min={0}
            max={7}
            defaultValue={1}
            required
          />
        </Field>
        {state.status === "failed" && <FailureNotice failure={state.failure} />}
        <FormActions>
          <SubmitButton pendingLabel="Rotating…">Rotate key</SubmitButton>
        </FormActions>
      </fieldset>
    </form>
  );
}
