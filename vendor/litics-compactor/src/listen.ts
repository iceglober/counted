/**
 * A dedicated LISTEN connection with reconnect.
 *
 * Postgres delivers notifications only to a session that issued LISTEN and
 * only over a direct connection — a transaction-mode pooler (Neon pooled,
 * Supavisor, PgBouncer) does not forward them. So this is its own `Client`,
 * on a URL the operator says is direct, and it is allowed to fail: the
 * compactor's timer is the fallback, and a lost listener degrades to timer
 * cadence, never to silence.
 */

import pg from "pg";
import { describeError, type Logger } from "./logger.js";

export type ListenerOptions = {
  url: string;
  channel: string;
  onNotify: (payload: string) => void;
  logger: Logger;
  reconnectMs?: number;
  maxReconnectMs?: number;
};

export type Listener = {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly connected: boolean;
};

export const listener = (opts: ListenerOptions): Listener => {
  const { Client } = pg;
  let client: InstanceType<typeof Client> | null = null;
  let stopping = false;
  let connected = false;
  let backoff = opts.reconnectMs ?? 1000;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = (): void => {
    if (stopping || retry !== null) return;
    const delay = backoff;
    backoff = Math.min(backoff * 2, opts.maxReconnectMs ?? 30_000);
    retry = setTimeout(() => {
      retry = null;
      void connect();
    }, delay);
  };

  const connect = async (): Promise<void> => {
    if (stopping) return;
    const next = new Client({ connectionString: opts.url });
    next.on("notification", (n) => opts.onNotify(n.payload ?? ""));
    next.on("error", (cause) => {
      opts.logger.warn("listener.error", { detail: describeError(cause) });
    });
    next.on("end", () => {
      connected = false;
      if (client === next) client = null;
      if (!stopping) {
        opts.logger.warn("listener.disconnected", { channel: opts.channel });
        scheduleReconnect();
      }
    });
    try {
      await next.connect();
      await next.query(`LISTEN ${opts.channel}`);
      client = next;
      connected = true;
      backoff = opts.reconnectMs ?? 1000;
      opts.logger.info("listener.connected", { channel: opts.channel });
    } catch (cause) {
      opts.logger.warn("listener.connect_failed", { detail: describeError(cause), retryMs: backoff });
      await next.end().catch(() => undefined);
      scheduleReconnect();
    }
  };

  return {
    get connected() {
      return connected;
    },
    start: () => connect(),
    async stop() {
      stopping = true;
      if (retry !== null) {
        clearTimeout(retry);
        retry = null;
      }
      const current = client;
      client = null;
      connected = false;
      await current?.end().catch(() => undefined);
    },
  };
};
