import Link from "next/link";
import { CenteredPage, PageHeader } from "../../../components/layout";
import { InsightGrid } from "../../../components/insight-grid";
/**
 * A shared dashboard, read-only and unauthenticated.
 *
 * The two share routes have no 401 and no 403 — only 404 — because a wrong
 * token and an unshared dashboard have to be indistinguishable. If they were
 * not, the endpoint would be an oracle for which dashboards have live links.
 * This page keeps that property: every failure renders the same sentence.
 *
 * The token travels in the path here and as a query parameter to the API. That
 * is the contract's shape, and it is why a share URL should be treated as the
 * credential it is.
 */

import { attempt, contractClient } from "../../../lib/client";
import { Empty } from "../../../components/notice";

export const dynamic = "force-dynamic";


const Shared = async ({
  params,
}: {
  readonly params: Promise<{ readonly token: string }>;
}) => {
  const { token } = await params;

  // No cookie, no header, nothing. A share link is its own authority and
  // forwarding a signed-in reader's session here would quietly make the page
  // show more to some readers than to others.
  const client = contractClient({ authority: {} });
  const [view, readouts] = await Promise.all([
    attempt(client.share.view({ shareToken: token })),
    attempt(client.share.readouts({ shareToken: token })),
  ]);

  if (!view.ok) {
    return (
      <CenteredPage>
        <h1 className="font-heading text-2xl">Not available</h1>
        {/*
          Deliberately not error-styled, and deliberately one sentence for every
          cause. "No such link", "expired" and "revoked" must read identically
          or this page becomes a way to enumerate live links.
        */}
        <Empty>
          This link is not available. It may have expired, or it may never have
          existed.
        </Empty>
      </CenteredPage>
    );
  }

  const dashboard = view.value.dashboard;

  return (
    <main className="app-content mx-auto min-h-dvh max-w-[1320px] px-5 py-8 sm:px-8 lg:p-10">
      <Link href="/" className="mb-8 inline-block font-heading text-xl">
        counted
      </Link>
      <PageHeader
        title={dashboard.name}
        purpose="Shared dashboard · Read-only"
      />
      {dashboard.tiles.length ? <InsightGrid dashboard={dashboard} readouts={readouts.ok ? readouts.value.readouts : []} /> : <Empty>This dashboard has no insights.</Empty>}
    </main>
  );
};
export default Shared;
