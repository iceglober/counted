import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@counted/ui/components/tabs";
import { MonitorAnalysisEditor } from "../../../../components/monitor-analysis-editor";
import { NewMonitor } from "../../../../components/new-monitor";
import { SelectControl } from "../../../../components/select-control";
import { Input } from "@counted/ui/components/input";
import { Textarea } from "@counted/ui/components/textarea";
/**
 * Every monitor in the workspace, and the writes that belong to one.
 *
 * A monitor watches one number and tells you when it crosses a threshold. It
 * holds the same `Analysis` a tile holds, restricted to the scalar shape — the
 * form here never offers another, so `AnalysisMustBeScalar` is a refusal this
 * page cannot provoke.
 *
 * One page, not a list and a detail. `monitors.get` returns the same `Monitor`
 * the list already carries and there is no per-monitor history to show, so
 * editing happens here against `?edit=<id>`: a row's Edit link opens the three
 * forms below the table, and every write returns to that URL so they stay
 * open. Threshold and delivery are two forms on purpose — see
 * `actions/monitors.ts`.
 */
import Link from "next/link";
import { attempt } from "../../../../lib/client";
import { clientForCaller } from "../../../../lib/session";
import { requireAccount } from "../../../../lib/guard";
import { failureFromQuery } from "../../../../lib/failure";
import { Shell } from "../../../../components/shell";
import {
  Disclosure,
  DetailEmpty,
  KeyValues,
  MasterDetail,
  MasterList,
  MasterRow,
  PageHeader,
  Region,
} from "../../../../components/layout";
import { Empty, FailureNotice } from "../../../../components/notice";
import { SubmitButton } from "../../../../components/submit";
import { Field, Fields, FormActions } from "../../../../components/form";
import { MonitorStatePill } from "../../../../components/pill";
import {
  deleteMonitor,
  disableMonitor,
  enableMonitor,
  renameMonitor,
  setMonitorDelivery,
  setMonitorThreshold,
} from "../../../../actions/monitors";
import type { Monitor } from "../../../../lib/monitors";
import {
  channelLines,
  COMPARISONS,
  COOLDOWN_UNITS,
  describeAnalysis,
  describeChannel,
  describeThreshold,
} from "../../../../lib/monitors";
import { durationMs, instant, measured } from "../../../../lib/format";
export const dynamic = "force-dynamic";
const CHANNEL_PLACEHOLDER =
  "ops@example.com\nhttps://example.com/hooks/counted";
const Editing = ({
  monitor,
  here,
  project,
  workspaceId,
}: {
  readonly monitor: Monitor;
  readonly here: string;
  readonly project: React.ReactNode;
  readonly workspaceId: string;
}) => (
  <>
    <h2>{monitor.name}</h2>

    <Tabs defaultValue="overview" className="min-w-0">
      <TabsList
        aria-label="Monitor details"
        className="grid w-full grid-cols-4 group-data-horizontal/tabs:h-auto"
      >
        <TabsTrigger value="overview" className="min-h-10 min-w-0 px-1 text-xs">
          Overview
        </TabsTrigger>
        <TabsTrigger value="measurement" className="min-h-10 min-w-0 px-1 text-xs">Measure</TabsTrigger>
        <TabsTrigger
          value="threshold"
          className="min-h-10 min-w-0 px-1 text-xs"
        >
          Threshold
        </TabsTrigger>
        <TabsTrigger value="delivery" className="min-h-10 min-w-0 px-1 text-xs">
          Delivery
        </TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="space-y-6 pt-5">
        <KeyValues
          rows={[
            { label: "Project", value: project },
            { label: "Watches", value: describeAnalysis(monitor.analysis) },
            {
              label: "Fires when",
              value: describeThreshold(monitor.threshold),
            },
            {
              label: "Last reading",
              value:
                monitor.lastValue === null ? (
                  <span className="text-muted-foreground">none yet</span>
                ) : (
                  measured(monitor.lastValue)
                ),
            },
            {
              label: "Last alert queued",
              value:
                monitor.lastNotifiedAt === null
                  ? "Never"
                  : `${instant(monitor.lastNotifiedAt)} UTC`,
            },
            { label: "Last checked", value: monitor.lastAttemptAt === null ? "Not yet checked" : `${instant(monitor.lastAttemptAt)} UTC` },
            { label: "Last measured", value: monitor.lastMeasuredAt === null ? "No measurement yet" : `${instant(monitor.lastMeasuredAt)} UTC` },
            ...(monitor.evaluationError ? [{ label: "Check status", value: monitor.evaluationError }] : []),
            ...(monitor.deliveryError ? [{ label: "Delivery status", value: monitor.deliveryError }] : []),
            { label: "Last delivery", value: monitor.lastDeliveredAt === null ? "None yet" : `${instant(monitor.lastDeliveredAt)} UTC` },
            ...(monitor.pendingDeliveries > 0 ? [{ label: "Delivery queue", value: `${monitor.pendingDeliveries} pending${monitor.failedDeliveries > 0 ? ` · ${monitor.failedDeliveries} retrying after a delivery failure` : ""}` }] : []),
            {
              label: "Notifies",
              value:
                monitor.channels.length === 0 ? (
                  <span className="text-muted-foreground">nowhere</span>
                ) : (
                  monitor.channels.map(describeChannel).join(", ")
                ),
            },
          ]}
        />

        <div className="mt-6 flex min-w-0 flex-wrap items-end gap-3">
          <form action={monitor.enabled ? disableMonitor : enableMonitor}>
            <input type="hidden" name="monitorId" value={monitor.id} />
            <input type="hidden" name="returnTo" value={here} />
            <SubmitButton
              pendingLabel={monitor.enabled ? "Disabling…" : "Enabling…"}
              variant="outline"
              size="sm"
            >
              {monitor.enabled ? "Disable" : "Enable"}
            </SubmitButton>
          </form>
          <form action={deleteMonitor}>
            <input type="hidden" name="monitorId" value={monitor.id} />
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input
              type="hidden"
              name="returnTo"
              value={`/w/${workspaceId}/monitors`}
            />
            <SubmitButton
              pendingLabel="Deleting…"
              confirm={`Delete “${monitor.name}”? It stops watching immediately.`}
              variant="outline"
              size="sm"
            >
              Delete
            </SubmitButton>
          </form>
        </div>

        <Disclosure summary="Rename monitor">
          {" "}
          <form action={renameMonitor}>
            <input type="hidden" name="monitorId" value={monitor.id} />
            <input type="hidden" name="returnTo" value={here} />
            <Fields>
              <Field label="Name" htmlFor="edit-name">
                <Input
                  id="edit-name"
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={monitor.name}
                />
              </Field>
            </Fields>
            <FormActions>
              <SubmitButton pendingLabel="Saving…" variant="outline">
                Rename
              </SubmitButton>
            </FormActions>
          </form>
        </Disclosure>
      </TabsContent>
      <TabsContent value="measurement" className="space-y-5 pt-5">
        <MonitorAnalysisEditor monitor={monitor} returnTo={here} />
      </TabsContent>
      <TabsContent value="threshold" className="space-y-5 pt-5">
        <p>
          A new threshold resets the alert state and may trigger a fresh
          notification.
        </p>
        <form action={setMonitorThreshold}>
          <input type="hidden" name="monitorId" value={monitor.id} />
          <input type="hidden" name="returnTo" value={here} />
          <Fields>
            <Field label="Fires when the number is" htmlFor="edit-comparison">
              <SelectControl
                id="edit-comparison"
                name="comparison"
                defaultValue={monitor.threshold.comparison}
                items={[
                  ...COMPARISONS.map((comparison) => ({
                    value: String(comparison),
                    label: String(comparison),
                  })),
                ]}
              />
            </Field>
            <Field label="Value" htmlFor="edit-value" span="narrow">
              <Input
                id="edit-value"
                name="value"
                type="number"
                step="any"
                required
                defaultValue={monitor.threshold.value}
              />
            </Field>
          </Fields>
          <FormActions>
            <SubmitButton pendingLabel="Saving…" variant="outline">
              Save threshold
            </SubmitButton>
          </FormActions>
        </form>
      </TabsContent>
      <TabsContent value="delivery" className="space-y-5 pt-5">
        <p>Update notifications without resetting the alert state.</p>
        <form action={setMonitorDelivery}>
          <input type="hidden" name="monitorId" value={monitor.id} />
          <input type="hidden" name="returnTo" value={here} />
          <Fields>
            <Field
              label="Notify"
              htmlFor="edit-channels"
              span="full"
              hint="Email addresses or webhook URLs, one per line. Leave blank to mute notifications."
            >
              <Textarea
                id="edit-channels"
                name="channels"
                rows={3}
                defaultValue={channelLines(monitor.channels)}
                placeholder={CHANNEL_PLACEHOLDER}
              />
            </Field>
            <Field
              label="Cooldown"
              htmlFor="edit-cooldownAmount"
              span="narrow"
              hint={`Currently ${durationMs(monitor.cooldownMs)}. Blank keeps it.`}
            >
              <Input
                id="edit-cooldownAmount"
                name="cooldownAmount"
                type="number"
                min={0}
                step={1}
                placeholder="unchanged"
              />
            </Field>
            <Field label="Unit" htmlFor="edit-cooldownUnit" span="narrow">
              <SelectControl
                id="edit-cooldownUnit"
                name="cooldownUnit"
                defaultValue="hour"
                items={[
                  ...COOLDOWN_UNITS.map((unit) => ({
                    value: String(unit.value),
                    label: String(unit.label),
                  })),
                ]}
              />
            </Field>
          </Fields>
          <FormActions>
            <SubmitButton pendingLabel="Saving…" variant="outline">
              Save delivery
            </SubmitButton>
          </FormActions>
        </form>
      </TabsContent>
    </Tabs>
  </>
);
const Monitors = async ({
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
  const list = `/w/${workspaceId}/monitors`;
  const client = await clientForCaller();
  const [me, monitors, projects] = await Promise.all([
    attempt(client.account.me({})),
    attempt(client.monitors.list({ workspaceId })),
    // Archived included: a monitor on an archived project still names it, and
    // the row should say which one rather than show an id.
    attempt(client.projects.list({ workspaceId, includeArchived: "true" })),
  ]);
  const account = requireAccount(me, `/w/${workspaceId}/monitors`);
  const projectName = new Map<string, string>();
  if (projects.ok) {
    for (const project of projects.value.items)
      projectName.set(project.id, project.name);
  }
  const usableProjects = projects.ok
    ? projects.value.items.filter((one) => !one.archived)
    : [];
  const editId = typeof query.edit === "string" ? query.edit : undefined;
  const editing = monitors.ok
    ? monitors.value.items.find((one) => one.id === editId)
    : undefined;
  const here = editing === undefined ? list : `${list}?edit=${editing.id}`;
  return (
    <Shell me={account} workspaceId={workspaceId} section="monitors">
      <PageHeader
        title="Monitors"
        purpose="Alerts when your metrics cross a threshold."
        {...(usableProjects.length === 0
          ? {}
          : {
              actions: (
                <NewMonitor
                  workspaceId={workspaceId}
                  returnTo={here}
                  projects={usableProjects}
                />
              ),
            })}
      />
      <FailureNotice failure={failureFromQuery(query)} />
      {!projects.ok && <FailureNotice failure={projects.failure} />}

      <Region>
        {!monitors.ok ? (
          <FailureNotice failure={monitors.failure} />
        ) : monitors.value.items.length === 0 ? (
          <Empty>
            {!projects.ok ? (
              "Projects could not be loaded. Reload to choose a monitor source."
            ) : usableProjects.length ? (
              "Create a monitor to watch a metric."
            ) : (
              <>
                <Link href={`/w/${workspaceId}/projects`}>
                  Create a project
                </Link>{" "}
                to start monitoring events.
              </>
            )}
          </Empty>
        ) : (
          <MasterDetail
            list={
              <MasterList
                count={`${monitors.value.items.length} ${monitors.value.items.length === 1 ? "monitor" : "monitors"}`}
                {...(() => {
                  const breaching = monitors.value.items.filter(
                    (one) => one.enabled && one.state === "breaching",
                  ).length;
                  return breaching === 0
                    ? {}
                    : { note: `${breaching} breaching` };
                })()}
              >
                {monitors.value.items.map((monitor) => (
                  <MasterRow
                    key={monitor.id}
                    href={`${list}?edit=${monitor.id}`}
                    current={monitor.id === editId}
                    title={monitor.name}
                    meta={
                      <>
                        <MonitorStatePill
                          enabled={monitor.enabled}
                          state={monitor.state}
                          lastMeasuredAt={monitor.lastMeasuredAt}
                          evaluationError={monitor.evaluationError}
                          failedDeliveries={monitor.failedDeliveries}
                        />{" "}
                        {projectName.get(monitor.project) ?? monitor.project}
                      </>
                    }
                  />
                ))}
              </MasterList>
            }
          >
            {editing === undefined ? (
              <DetailEmpty>Select a monitor to view its settings.</DetailEmpty>
            ) : (
              <Editing
                key={editing.id}
                monitor={editing}
                here={here}
                workspaceId={workspaceId}
                project={
                  projectName.get(editing.project) ?? (
                    <code>{editing.project}</code>
                  )
                }
              />
            )}
          </MasterDetail>
        )}
      </Region>
    </Shell>
  );
};
export default Monitors;
