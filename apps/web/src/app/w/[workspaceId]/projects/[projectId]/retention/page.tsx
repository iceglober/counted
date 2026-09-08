import { can } from "../../../../../../lib/permissions";
import { SelectControl } from "../../../../../../components/select-control";
import { Input } from "@counted/ui/components/input";
/**
 * How long this project's events are kept.
 *
 * Two numbers, and the difference between them is the point: the policy you
 * chose, and what the plan allows. A plan change moves the second without
 * touching the first, which is why `inherit` is a real setting rather than an
 * absent one.
 */
import { attempt } from "../../../../../../lib/client";
import { clientForCaller } from "../../../../../../lib/session";
import { requireAccount } from "../../../../../../lib/guard";
import { failureFromQuery } from "../../../../../../lib/failure";
import { KeyValues, Panel, Region } from "../../../../../../components/layout";
import { Field, Fields, FormActions } from "../../../../../../components/form";
import { FailureNotice } from "../../../../../../components/notice";
import { SubmitButton } from "../../../../../../components/submit";
import { setRetention } from "../../../../../../actions/projects";
import { ProjectFrame, ProjectMissing } from "../frame";
export const dynamic = "force-dynamic";
const Retention = async ({
  params,
  searchParams,
}: {
  readonly params: Promise<{
    readonly workspaceId: string;
    readonly projectId: string;
  }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const { workspaceId, projectId } = await params;
  const query = await searchParams;
  const here = `/w/${workspaceId}/projects/${projectId}/retention`;
  const client = await clientForCaller();
  const [me, project] = await Promise.all([
    attempt(client.account.me({})),
    attempt(client.projects.get({ projectId })),
  ]);
  const account = requireAccount(me, here);
  const canWrite = can(account, workspaceId, "projects:write");
  if (!project.ok) {
    return (
      <ProjectMissing
        me={account}
        workspaceId={workspaceId}
        failure={project.failure}
      />
    );
  }
  const one = project.value.project;
  return (
    <ProjectFrame
      me={account}
      workspaceId={workspaceId}
      project={one}
      tab="retention"
    >
      <FailureNotice failure={failureFromQuery(query)} />

      <Region title="Retention">
        <KeyValues
          rows={[
            {
              label: "Policy",
              value:
                one.retention.kind === "inherit"
                  ? "Inherit from the plan"
                  : `${one.retention.days} days`,
            },
            {
              label: "In effect",
              value:
                one.effectiveRetentionDays === null
                  ? "kept indefinitely"
                  : `${one.effectiveRetentionDays} days`,
            },
          ]}
        />
        <p className="mt-6">
          Retention follows your plan unless you set a shorter window.
        </p>
      </Region>

      {canWrite ? <Region>
        <Panel
          title="Change retention"
          hint="Shortening it deletes events older than the new window on the next sweep."
        >
          <form action={setRetention}>
            <input type="hidden" name="projectId" value={one.id} />
            <input type="hidden" name="returnTo" value={here} />
            <Fields>
              <Field label="Policy" htmlFor="kind">
                <SelectControl
                  id="kind"
                  name="kind"
                  defaultValue={one.retention.kind}
                  items={[
                    {
                      value: String("inherit"),
                      label: "Inherit from the plan",
                    },
                    { value: String("days"), label: "A fixed number of days" },
                  ]}
                />
              </Field>
              <Field
                label="Days"
                htmlFor="days"
                span="narrow"
                hint="Used when the policy is a fixed number."
              >
                <Input
                  id="days"
                  name="days"
                  type="number"
                  min={1}
                  max={3650}
                  defaultValue={
                    one.retention.kind === "days"
                      ? one.retention.days
                      : undefined
                  }
                  placeholder="90"
                />
              </Field>
            </Fields>
            <FormActions note="Your plan’s retention limit still applies.">
              <SubmitButton pendingLabel="Saving…" variant="outline">
                Save retention
              </SubmitButton>
            </FormActions>
          </form>
        </Panel>
      </Region> : <p className="text-sm text-muted-foreground">An owner or admin can change retention.</p>}
    </ProjectFrame>
  );
};
export default Retention;
