import Link from "next/link";
import { PageHeader } from "../../components/layout";
import { AccountSettings } from "../../components/account-settings";
import { attempt } from "../../lib/client";
import { clientForCaller } from "../../lib/session";
import { requireAccount } from "../../lib/guard";
import { emailAvailable } from "../../lib/auth-capabilities";
import { leaveWorkspace } from "../../actions/workspaces";
import { SubmitButton } from "../../components/submit";
import { Region } from "../../components/layout";
import { FailureNotice } from "../../components/notice";
import { failureFromQuery } from "../../lib/failure";

export const dynamic = "force-dynamic";
export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [me, emailEnabled] = await Promise.all([attempt((await clientForCaller()).account.me({})), emailAvailable()]);
  const { account, workspaces } = requireAccount(me, "/account");
  return <main className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-12"><Link href="/" className="mb-8 inline-block text-sm underline underline-offset-4">Back to workspace</Link><PageHeader title="Account" purpose="Your profile, sign-in methods, and connected applications." /><FailureNotice failure={failureFromQuery(await searchParams)} /><AccountSettings email={account.email} name={account.name} verified={account.emailVerified} emailEnabled={emailEnabled} canClose={workspaces.length === 0} /><Region title="Workspaces"><p className="text-sm text-muted-foreground">The last owner must make another member an owner before leaving.</p>{workspaces.map((workspace) => <div className="flex flex-wrap items-center justify-between gap-4 border-b py-4" key={workspace.id}><Link className="min-w-0 break-words text-sm underline underline-offset-4" href={`/w/${workspace.id}/members`}>{workspace.name}</Link><form action={leaveWorkspace}><input type="hidden" name="workspaceId" value={workspace.id} /><SubmitButton variant="outline" pendingLabel="Leaving…" confirm={`Leave ${workspace.name}? You will need an invitation to rejoin.`}>Leave workspace</SubmitButton></form></div>)}</Region></main>;
}
