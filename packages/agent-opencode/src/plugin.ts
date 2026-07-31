/**
 * The native OpenCode plugin.
 *
 * Unlike a Claude Code hook, OpenCode loads this once per process and keeps the
 * returned hooks for its lifetime — so there is one long-lived tracker that
 * batches, rather than a process per event that flushes and dies.
 *
 * The one thing that needs care is sessions: OpenCode drives many of them
 * through one server process, so the tracker is re-created per session id.
 * Collapsing them into one process-lifetime session would merge a day's work
 * into a single row.
 */

import {
  createAgentTracker,
  type AgentTracker,
  type SetupProjection,
} from "@counted/agent-core";
import { openCodeProjection } from "@counted/agent";

/** Structural only. The authoritative types live in `@opencode-ai/plugin`. */
type Hooks = Record<string, (...args: never[]) => unknown>;
type PluginInput = { directory?: string; worktree?: string; [key: string]: unknown };

const endpoint = (): string | undefined => process.env["COUNTED_AGENT_ENDPOINT"];

const sessionIdOf = (event: unknown): string | undefined => {
  const properties = (event as { properties?: Record<string, unknown> })?.properties ?? {};
  const candidate =
    (properties["info"] as { id?: unknown } | undefined)?.id ??
    properties["sessionID"] ??
    properties["sessionId"] ??
    properties["id"];
  return typeof candidate === "string" ? candidate : undefined;
};

export const CountedPlugin = async (input: PluginInput): Promise<Hooks> => {
  const cwd = input.directory ?? input.worktree;
  const key = process.env["COUNTED_AGENT_KEY"];

  let tracker: AgentTracker | null = null;
  let sessionId: string | undefined;
  // Held rather than registered once, because re-keying to a new session
  // builds a fresh tracker and a fresh tracker has no context.
  let projection: SetupProjection | null = null;

  /**
   * Point the tracker at a session id, building one if needed.
   *
   * Flushes the outgoing session first: its events belong to it, and the new
   * tracker would send them under the new session's visit.
   */
  const useSession = async (next: string | undefined): Promise<AgentTracker | null> => {
    if (key === undefined) return null;
    if (tracker !== null && (next === undefined || next === sessionId)) return tracker;
    if (tracker !== null) await tracker.flush();

    sessionId = next ?? sessionId;
    tracker = createAgentTracker({
      key,
      host: "opencode",
      endpoint: endpoint(),
      sessionId,
      label: process.env["COUNTED_SETUP_LABEL"],
      onInvalid: "drop",
    });
    if (projection !== null) tracker.registerSetup(projection);
    return tracker;
  };

  // Tool arguments arrive on the before-hook and are not guaranteed to survive
  // to the after-hook, so they are held by call id across the pair.
  const pending = new Map<string, Record<string, unknown>>();

  return {
    /** OpenCode hands the plugin its merged config. Fingerprint it once. */
    config: async (config: Record<string, unknown>) => {
      projection = openCodeProjection(config ?? {});
      const active = await useSession(undefined);
      active?.registerSetup(projection);
    },

    event: async ({ event }: { event: { type?: string } }) => {
      const type = event?.type;
      if (type === "session.created") {
        const active = await useSession(sessionIdOf(event));
        active?.sessionStart({ mode: "agent" });
      } else if (type === "session.deleted") {
        const active = await useSession(sessionIdOf(event));
        active?.sessionEnd({});
        await active?.flush();
      } else if (type === "session.idle") {
        // End of a turn in all but name, and the right moment to flush.
        await tracker?.flush();
      }
    },

    "tool.execute.before": async (
      hook: { callID?: string },
      output: { args?: Record<string, unknown> },
    ) => {
      if (hook?.callID !== undefined && output?.args !== undefined) pending.set(hook.callID, output.args);
    },

    /**
     * Fires after a successful tool call — OpenCode surfaces failures on the
     * event stream rather than here, so reaching this hook *is* the success.
     */
    "tool.execute.after": async (
      hook: { tool?: string; sessionID?: string; callID?: string },
      output: { args?: Record<string, unknown> },
    ) => {
      // Keyed to the tool's own session even if `session.created` was missed.
      const active = await useSession(hook?.sessionID);
      if (active === null) return;

      const tool = hook?.tool ?? "unknown";
      active.toolUse({ tool, outcome: "success" });

      const callID = hook?.callID;
      const args = output?.args ?? (callID === undefined ? undefined : pending.get(callID)) ?? {};
      if (callID !== undefined) pending.delete(callID);

      const filePath = args["filePath"];
      if (typeof filePath === "string" && (tool === "edit" || tool === "write")) {
        active.fileEdit({ filePath, action: tool === "write" ? "create" : "edit", cwd });
      }
      const command = args["command"];
      if (typeof command === "string" && tool === "bash") {
        active.commandRun({ command });
      }
    },

    dispose: async () => {
      await tracker?.shutdown();
      tracker = null;
    },
  };
};

export default CountedPlugin;
