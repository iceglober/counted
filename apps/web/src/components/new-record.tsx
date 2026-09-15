"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useSetupKey } from "./setup-key";
import { Input } from "@counted/ui/components/input";
import { CreationDialog, CreationForm } from "./creation-dialog";
import { Field } from "./form";
import { SelectControl } from "./select-control";
import { createDashboard } from "../actions/dashboards";
import { createProject } from "../actions/projects";
import { invite } from "../actions/members";

type Props = { workspaceId: string; returnTo: string };
export function NewRecord({
  kind,
  ...props
}: Props & { kind: "dashboard" | "project" }) {
  return (
    <CreationDialog title={`New ${kind}`}>
      <NamedDraft kind={kind} {...props} />
    </CreationDialog>
  );
}
function NamedDraft({
  kind,
  workspaceId,
  returnTo,
}: Props & { kind: "dashboard" | "project" }) {
  const id = useId();
  const router = useRouter();
  const { prepare } = useSetupKey();
  async function create(form: FormData) {
    if (kind === "dashboard") return createDashboard(form);
    const result = await createProject(form);
    if (!result.ok) return result.failure;
    const path = `/w/${workspaceId}/projects/${result.value.project.id}`;
    prepare(path, result.value.credential.secret);
    router.push(`${path}?setup=1`);
    return null;
  }
  return (
    <CreationForm action={create} submitLabel={`Create ${kind}`}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Field label="Name" htmlFor={id}>
        <Input
          id={id}
          name="name"
          required
          maxLength={200}
          placeholder={kind === "dashboard" ? "Web overview" : "my-app"}
        />
      </Field>
    </CreationForm>
  );
}
export function InviteMember(props: Props) {
  return (
    <CreationDialog title="Invite member">
      <InvitationDraft {...props} />
    </CreationDialog>
  );
}
function InvitationDraft({ workspaceId, returnTo }: Props) {
  const id = useId();
  const [role, setRole] = useState("member");
  const descriptions: Record<string, string> = {
    member: "Manage dashboards and monitors.",
    admin: "Manage projects, keys, dashboards, and monitors.",
    owner: "Full access, including membership and billing.",
  };
  return (
    <CreationForm
      action={invite}
      submitLabel="Send invitation"
      pendingLabel="Inviting…"
      successHref={`${returnTo}?invited=1`}
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Field label="Email" htmlFor={`${id}-email`}>
        <Input
          id={`${id}-email`}
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="colleague@example.com"
        />
      </Field>
      <Field label="Role" htmlFor={`${id}-role`} hint={descriptions[role]}>
        <SelectControl
          id={`${id}-role`}
          name="role"
          value={role}
          onValueChange={(value) => setRole(value ?? "member")}
          items={["member", "admin", "owner"].map((value) => ({
            value,
            label: value[0]!.toUpperCase() + value.slice(1),
          }))}
        />
      </Field>
    </CreationForm>
  );
}
