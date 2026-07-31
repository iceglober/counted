import { requireCaller, workspaceFrom } from "@/lib/session";

export const dynamic = "force-dynamic";

type Subscription = {
  readonly plan: "free" | "pro";
  readonly paymentState: "none" | "active" | "past_due" | "canceled";
  readonly inGrace: boolean;
  readonly renewsAt: string | null;
};

type Usage = {
  readonly events: { readonly used: number; readonly limit: number | null; readonly state: string };
  readonly projects: { readonly used: number; readonly limit: number | null };
};

/**
 * Settings: the account, and billing. Nothing else.
 *
 * v1's Settings was where anything without an obvious home ended up — a
 * general tab, billing, and an **alerts tab with its own project selector**.
 * That selector competed with the shell's project context, so the alert you
 * created could belong to a project other than the one you were looking at.
 *
 * Monitors now live on the project they watch. What is left here is the two
 * things that are genuinely about you rather than about a project: who you are
 * signed in as, and what you are paying.
 *
 * Every number on this page comes from the API. The plan, the limits, whether
 * a payment is in grace — all of it is decided by the server and rendered
 * here. A banner computed in the browser from a plan name is a second opinion
 * about entitlement, and v1 had three of them that disagreed.
 */
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const caller = await requireCaller();
  const workspace = workspaceFrom(caller, (await searchParams).workspace);

  // `null` on failure, so a section that could not be read renders as an
  // error rather than as zeroes. A usage panel showing 0/0 because the request
  // failed is the same lie as an empty chart.
  const [subscription, usage] = await Promise.all([
    caller.api<Subscription>("getSubscription", { params: { workspaceId: workspace.id } }).then((r) => r.data, () => null),
    caller.api<Usage>("getUsage", { params: { workspaceId: workspace.id } }).then((r) => r.data, () => null),
  ]);

  return (
    <main>
      <h1>Settings</h1>

      <h2>Account</h2>
      <table>
        <tbody>
          <tr>
            <td>Signed in as</td>
            <td>{caller.principal}</td>
          </tr>
          <tr>
            <td>Workspace</td>
            <td>
              {workspace.name} <span className="tile-empty">· {workspace.role}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Billing</h2>
      {subscription === null ? (
        <p className="tile-error" role="alert">
          The subscription for this workspace could not be read.
        </p>
      ) : (
        <table>
          <tbody>
            <tr>
              <td>Plan</td>
              <td>{subscription.plan}</td>
            </tr>
            <tr>
              <td>Payment</td>
              <td style={subscription.paymentState === "past_due" ? { color: "var(--error)" } : undefined}>
                {subscription.paymentState}
                {/* The server decides whether a past-due account still has
                    Pro limits. v1 answered that question in three places. */}
                {subscription.inGrace && <span className="tile-empty"> · in grace</span>}
              </td>
            </tr>
            {subscription.renewsAt !== null && (
              <tr>
                <td>Renews</td>
                <td>{new Date(subscription.renewsAt).toISOString().slice(0, 10)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <h2>Usage</h2>
      {usage === null ? (
        <p className="tile-error" role="alert">
          Usage for this workspace could not be read.
        </p>
      ) : (
        <table>
          <tbody>
            <tr>
              <td>Events this period</td>
              <td className="numeric">
                {usage.events.used.toLocaleString("en-US")}
                {usage.events.limit !== null && ` / ${usage.events.limit.toLocaleString("en-US")}`}
              </td>
            </tr>
            <tr>
              <td>Projects</td>
              <td className="numeric">
                {usage.projects.used}
                {usage.projects.limit !== null && ` / ${usage.projects.limit}`}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </main>
  );
}
