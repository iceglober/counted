import { CenteredPage, Panel } from "../../components/layout";
import { Field, FormActions } from "../../components/form";
import { Input } from "@counted/ui/components/input";
/**
 * What a new account sees: one form, because with no workspace there is
 * nothing else to look at.
 *
 * A reader who already has a workspace is sent to it rather than shown this —
 * arriving here from a bookmark should not offer to create a second one by
 * default.
 */

import { redirect } from "next/navigation";
import { attempt } from "../../lib/client";
import { clientForCaller } from "../../lib/session";
import { requireAccount } from "../../lib/guard";
import { failureFromQuery } from "../../lib/failure";
import { FailureNotice } from "../../components/notice";
import { SubmitButton } from "../../components/submit";
import { createWorkspace } from "../../actions/workspaces";

export const dynamic = "force-dynamic";

const Welcome = async ({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const client = await clientForCaller();
  const me = requireAccount(await attempt(client.account.me({})));
  const query = await searchParams;

  const existing = me.workspaces[0];
  if (existing !== undefined && query.again === undefined) {
    redirect(`/w/${existing.id}/dashboards`);
  }

  return (
    <CenteredPage>
      <div>
        <h1 className="font-heading text-2xl">A place for your work.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Your workspace brings projects, dashboards, and people together.
        </p>
      </div>
      <FailureNotice failure={failureFromQuery(query)} />
      <Panel title="Create a workspace">
        <form action={createWorkspace}>
          <input type="hidden" name="returnTo" value="/welcome?again=1" />
          <Field label="Workspace name" htmlFor="name">
            <Input
              id="name"
              name="name"
              required
              maxLength={200}
              placeholder="Acme"
            />
          </Field>
          <FormActions>
            <SubmitButton pendingLabel="Creating…">
              Create workspace
            </SubmitButton>
          </FormActions>
        </form>
      </Panel>
    </CenteredPage>
  );
};

export default Welcome;
