import { Card, CardContent, CardHeader } from "@counted/ui/components/card";
import { CenteredPage } from "../../../components/layout";
import { OAuthConsent } from "../../../components/oauth-consent";
import { attempt } from "../../../lib/client";
import { clientForCaller } from "../../../lib/session";
import { requireAccount } from "../../../lib/guard";
import { oauthQuery } from "../../../lib/oauth-query";

export const dynamic = "force-dynamic";
export default async function ContinuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = oauthQuery(await searchParams);
  const me = requireAccount(await attempt((await clientForCaller()).account.me({})), `/oauth/continue?${query}`);
  return <CenteredPage><Card><CardHeader><h1 className="font-heading text-xl">Connect an application</h1></CardHeader><CardContent><OAuthConsent query={query} email={me.account.email} continuation /></CardContent></Card></CenteredPage>;
}
