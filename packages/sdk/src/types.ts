export type EventProperties = Record<string, string | number | boolean>;

export type AnalyticsOptions = {
  projectKey: string;
  host?: string;
  flushInterval?: number;
  maxBatchSize?: number;
  sessionId?: string;
  sessionTimeout?: number;
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
