import { Progress } from "@counted/ui/components/progress";
import { Alert, AlertDescription } from "@counted/ui/components/alert";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@counted/ui/components/table";
import { PlanUpgrade } from "../../../../components/plan-upgrade";
import { CheckoutStatus } from "../../../../components/checkout-status";
import { Input } from "@counted/ui/components/input";
/**
 * The plan, what has been used against it, and the way out of the free tier.
 *
 * v2 had no upgrade path at all: `/settings/billing` was a 404 that Stripe
 * returned the customer to after they had paid. The button here is the fix, and
 * the thing it must never do is fail quietly — if the API has no billing route
 * mounted, the action says so in words rather than throwing.
 *
 * Three usage rows, and the events row carries the quota pill. `overage` is
 * amber and `rejected` is red because they are different facts: one is "past
 * the allowance and still storing", the other is "events are being dropped".
 * Collapsing them is how a customer discovers a hard stop from a missing chart.
 */
import { attempt } from "../../../../lib/client";
import { clientForCaller } from "../../../../lib/session";
import { requireAccount } from "../../../../lib/guard";
import { failureFromQuery } from "../../../../lib/failure";
import { Shell } from "../../../../components/shell";
import {
  PageHeader,
  Region,
  Tabs,
  KeyValues,
} from "../../../../components/layout";
import { Field, FormActions } from "../../../../components/form";
import { FailureNotice } from "../../../../components/notice";
import { SubmitButton } from "../../../../components/submit";
import { QuotaPill } from "../../../../components/pill";
import { renameWorkspace } from "../../../../actions/workspaces";
import { manageBilling } from "../../../../actions/billing";
import { count, limit, percentOf, day, instant } from "../../../../lib/format";
import { money } from "../../../../lib/money";
export const dynamic = "force-dynamic";
const Settings = async ({
  params,
  searchParams,
}: {
  readonly params: Promise<{
    readonly workspaceId: string;
  }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const { workspaceId } = await params;
  const query = await searchParams;
  const here = `/w/${workspaceId}/settings`;
  const tab =
    query.tab === "plan" || query.tab === "usage"
      ? query.tab
      : query.upgraded !== undefined
        ? "plan"
        : "workspace";
  const planPath = `${here}?tab=plan`;
  const client = await clientForCaller();
  const [me, workspace, usage] = await Promise.all([
    attempt(client.account.me({})),
    attempt(client.workspaces.get({ workspaceId })),
    attempt(client.workspaces.usage({ workspaceId })),
  ]);
  const account = requireAccount(me, `${here}?tab=${tab}`);
  const role = account.workspaces.find((one) => one.id === workspaceId)?.role;
  const canPay = role === "owner";
  const [plans, subscription] = (role === "owner" || role === "admin") && tab === "plan" ? await Promise.all([
    attempt(client.billing.plans({ workspaceId })),
    attempt(client.billing.subscription({ workspaceId })),
  ]) : [null, null];
  const billing = subscription?.ok ? subscription.value : null;
  const details = billing?.details;
  const hasPaidPeriod = billing?.subscription.payment === "active" || billing?.subscription.payment === "past_due";
  return (
    <Shell me={account} workspaceId={workspaceId} section="settings">
      <PageHeader title="Settings" />
      <Tabs
        label="Settings"
        items={[
          { label: "Workspace", href: here, current: tab === "workspace" },
          { label: "Plan", href: planPath, current: tab === "plan" },
          {
            label: "Usage",
            href: `${here}?tab=usage`,
            current: tab === "usage",
          },
        ]}
      />
      <FailureNotice failure={failureFromQuery(query)} />
      {query.upgraded !== undefined && <CheckoutStatus active={workspace.ok && workspace.value.workspace.plan === "pro" && workspace.value.workspace.payment === "active"} />}
      {query.checkout === "canceled" && <Alert className="my-5"><AlertDescription>Checkout was canceled. Your plan has not changed.</AlertDescription></Alert>}

      <div className="max-w-2xl">
        {tab === "workspace" && (
          <Region title="Workspace details">
            {!workspace.ok ? (
              <FailureNotice failure={workspace.failure} />
            ) : role === "owner" ? (
              <form action={renameWorkspace} className="max-w-lg">
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <input type="hidden" name="returnTo" value={here} />
                <Field label="Workspace name" htmlFor="name">
                  <Input
                    id="name"
                    name="name"
                    required
                    maxLength={200}
                    defaultValue={workspace.value.workspace.name}
                  />
                </Field>
                <FormActions>
                  <SubmitButton pendingLabel="Saving…">
                    Save changes
                  </SubmitButton>
                </FormActions>
              </form>
            ) : (
              <>
                <KeyValues
                  rows={[
                    { label: "Name", value: workspace.value.workspace.name },
                  ]}
                />
                <p className="text-sm text-muted-foreground">
                  Only an owner can rename the workspace.
                </p>
              </>
            )}
          </Region>
        )}
        {tab === "plan" && (
          <Region title="Current plan">
            {!workspace.ok ? (
              <FailureNotice failure={workspace.failure} />
            ) : (
              <>
                <p>
                  <strong className="capitalize">
                    {workspace.value.workspace.plan}
                  </strong>{" "}
                  plan.
                  {workspace.value.workspace.payment === "canceled"
                    ? " Your paid subscription has ended."
                    : ""}
                  {workspace.value.workspace.inGrace
                    ? " Payment failed. Your current limits remain during the grace period."
                    : ""}
                </p>

                {billing && hasPaidPeriod && (details?.cadence || details?.periodEndsAt || billing.subscription.renewsAt) && <KeyValues rows={[
                  ...(details?.cadence ? [{ label: "Billed", value: details.cadence === "annual" ? "Annually" : "Monthly" }] : []),
                  ...(details?.price ? [{ label: "Base price", value: money(details.price.amount, details.price.currency) + (details.cadence === "annual" ? " / year" : details.cadence === "monthly" ? " / month" : "") }] : []),
                  ...(details?.periodEndsAt || billing.subscription.renewsAt ? [{ label: details?.cancelAtPeriodEnd ? "Ends on" : "Next renewal", value: day(details?.periodEndsAt ?? billing.subscription.renewsAt!) + " (UTC)" }] : []),
                ]} />}
                {details?.cancelAtPeriodEnd && <p className="text-sm">Your subscription ends after this paid period. Free allowances apply afterward.</p>}
                {billing?.detailsUnavailable && <p className="text-sm text-muted-foreground">Subscription dates are temporarily unavailable. Your confirmed plan is shown above.</p>}
                {plans && !plans.ok && <FailureNotice failure={plans.failure} />}
                {subscription && !subscription.ok && <FailureNotice failure={subscription.failure} />}
                <Table aria-label="Plan comparison">
                  <TableHeader><TableRow><TableHead>Allowance</TableHead>{(plans?.ok ? plans.value.items : [{ id: workspace.value.workspace.plan, name: workspace.value.workspace.plan }]).map(plan => <TableHead key={plan.id} className="text-right capitalize">{plan.name}{plan.id === workspace.value.workspace.plan ? " · current" : ""}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>{([
                    ["eventsPerMonth", "Events per month"], ["projects", "Active projects"], ["seats", "Members"], ["retentionDays", "Retention"],
                  ] as const).map(([key, label]) => <TableRow key={key}><TableCell>{label}</TableCell>{(plans?.ok ? plans.value.items : [{ id: workspace.value.workspace.plan, limits: workspace.value.workspace.limits }]).map(plan => <TableCell key={plan.id} className="text-right tabular-nums">{limit(plan.limits[key])}{key === "retentionDays" && plan.limits[key] !== null ? " days" : ""}</TableCell>)}</TableRow>)}</TableBody>
                </Table>

                {canPay ? (
                  <div className="flex min-w-0 flex-wrap items-end gap-3">
                    {workspace.value.workspace.plan === "free" && plans?.ok && plans.value.pricing === "available" && <PlanUpgrade workspaceId={workspaceId} prices={plans.value.prices} />}
                    {plans?.ok && plans.value.pricing !== "available" && <p className="text-sm text-muted-foreground">{plans.value.pricing === "unconfigured" ? "Billing is not enabled on this installation." : "Pricing is temporarily unavailable. Refresh this page to try again."}</p>}
                    {billing?.billingAvailable && billing.subscription.hasBillingAccount && (
                    <form action={manageBilling}>
                      <input
                        type="hidden"
                        name="workspaceId"
                        value={workspaceId}
                      />
                      <input type="hidden" name="returnTo" value={planPath} />
                      <SubmitButton pendingLabel="Opening…" variant="outline">
                        Manage billing
                      </SubmitButton>
                    </form>)}
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    Only an owner can change the plan or open billing.
                  </p>
                )}
                {billing?.billingAvailable && <p className="text-xs text-muted-foreground">Stripe shows final invoices, including any taxes and discounts.</p>}
              </>
            )}
          </Region>
        )}
        {tab === "usage" && (
          <Region title="Usage">
            {!usage.ok ? (
              <FailureNotice failure={usage.failure} />
            ) : (
              <div className="space-y-6">
                <p className="text-sm text-muted-foreground">Events since {day(usage.value.usage.period.from)} · resets {day(usage.value.usage.period.resetsAt)} at 00:00 UTC. Updated {instant(usage.value.usage.period.measuredAt)} UTC.</p>
                {(["events", "projects", "seats"] as const).map((key) => {
                  const reading = usage.value.usage[key];
                  const share = percentOf(reading.used, reading.limit);
                  const label = key === "seats" ? "Members" : key === "projects" ? "Active projects" : "Events";
                  return (
                    <div
                      key={key}
                      className="space-y-3 border-b pb-6 last:border-0"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="font-medium">{label}</h3>
                        {key === "events" && (
                          <QuotaPill state={usage.value.usage.events.state} />
                        )}
                      </div>
                      <p className="text-sm tabular-nums">
                        <strong className="font-medium">
                          {count(reading.used)}
                        </strong>
                        <span className="text-muted-foreground">
                          {reading.limit === null
                            ? " used · unlimited"
                            : ` of ${count(reading.limit)} used`}
                        </span>
                      </p>
                      {share !== null && (
                        <Progress
                          value={share}
                          aria-label={`${label} allowance used`}
                          aria-valuetext={`${count(reading.used)} of ${count(reading.limit!)} used`}
                        />
                      )}
                    </div>
                  );
                })}
                {usage.value.usage.events.state !== "ok" && <Alert variant={usage.value.usage.events.state === "rejected" ? "destructive" : "default"}><AlertDescription>{usage.value.usage.events.state === "rejected" ? `New events are being rejected at the hard limit. ${workspace.ok && workspace.value.workspace.plan === "free" ? canPay ? "Review Pro on the Plan tab, or wait for the monthly reset." : "Ask a workspace owner about Pro, or wait for the monthly reset." : "Ingestion resumes at the monthly reset."} Rejected events are not stored.` : "Events are still accepted above your allowance, until the hard limit at 130%."}</AlertDescription></Alert>}
                <p className="text-xs text-muted-foreground">Project and member totals do not reset each month. Archived projects do not count toward the allowance.</p>
              </div>
            )}
          </Region>
        )}
      </div>
    </Shell>
  );
};
export default Settings;
