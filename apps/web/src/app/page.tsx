/**
 * The front door: send the reader to a workspace, or to the thing that has to
 * happen before there is one.
 *
 * `account.me` answers with the account *and* the workspaces it reaches, which
 * is why there is no second call here. A service key answers this route as the
 * account that issued it — irrelevant to a browser, but it is why the route
 * exists in this shape.
 */

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { SiteHome } from "../components/site-home";
import { isSiteHost, siteOrigin } from "../lib/site";
import { attempt } from "../lib/client";
import { clientForCaller } from "../lib/session";
import { isUnauthenticated } from "../lib/failure";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const site = isSiteHost((await headers()).get("host"));
  return site ? { title: "Counted — privacy-first product analytics", metadataBase: new URL(siteOrigin()), description: "Custom events, funnels, and dashboards you compose yourself. No tracking cookies or fingerprinting.", alternates: { canonical: "/", types: { "text/markdown": "/index.md" } } } : { robots: { index: false, follow: false } };
}
const Home = async ({ searchParams }: { searchParams: Promise<{ mode?: string }> }) => {
  if (isSiteHost((await headers()).get("host"))) {
    if ((await searchParams).mode === "agent") redirect("/index.md");
    return <SiteHome />;
  }
  const client = await clientForCaller();
  const me = await attempt(client.account.me({}));

  if (!me.ok) {
    if (isUnauthenticated(me.failure)) redirect("/sign-in");
    // Anything else is a real fault and the reader deserves to be told rather
    // than bounced to a sign-in page they are already past.
    throw new Error(`Could not read the calling account: ${me.failure.code}`);
  }

  const first = me.value.workspaces[0];
  if (first === undefined) redirect("/welcome");
  redirect(`/w/${first.id}/dashboards`);
};

export default Home;
