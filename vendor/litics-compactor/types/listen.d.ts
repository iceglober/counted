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
import { type Logger } from "./logger.js";
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
export declare const listener: (opts: ListenerOptions) => Listener;
