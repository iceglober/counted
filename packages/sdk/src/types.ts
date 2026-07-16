/**
 * Event property values. `undefined` values are stripped before sending; `null`
 * is sent as-is (the ingestion endpoint accepts null).
 */
export type EventProperties = Record<string, string | number | boolean | null | undefined>;

export type AnalyticsOptions = {
  /** Client key from your project settings (starts with `ck_`; legacy `A-US-` accepted). */
  projectKey: string;
  /** Ingestion host. Default: `https://app.counted.dev`. */
  host?: string;
  /** How often (ms) the buffer is flushed on a timer. Default: 30000. */
  flushInterval?: number;
  /** Max events per request. Capped at 50 (the server rejects larger batches). Default: 50. */
  maxBatchSize?: number;
  /** Pin a session id instead of generating one (e.g. to correlate a known session). */
  sessionId?: string;
  /** Idle timeout (ms) before a new session id is minted. Default: 30 minutes. `0` disables rollover. */
  sessionTimeout?: number;
  /** App version reported in system props (Aptabase compatibility). */
  appVersion?: string;
  /** When true (browser only), auto-track page views on route changes. Default: false. */
  autoTrack?: boolean;
  /** Log each track/flush to the console. Never throws. Default: false. */
  debug?: boolean;
  /**
   * Registered ("super") properties merged into every event's props. Set once
   * here or later via `register()`. Per-call props win on key collision.
   */
  context?: EventProperties;
};

export type SystemProps = {
  osName: string | null;
  osVersion: string | null;
  locale: string | null;
  appVersion: string | null;
  deviceModel: string | null;
  sdkVersion: string;
  isDebug: boolean;
};

export type RawEvent = {
  timestamp: string;
  sessionId: string;
  eventName: string;
  systemProps: SystemProps;
  props: EventProperties;
};
