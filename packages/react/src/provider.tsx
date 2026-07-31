/**
 * The Counted provider.
 *
 * A thin context around `useCounted`. Everything about the lifecycle — when a
 * client is rebuilt, what happens to queued events, what survives a rebuild —
 * is decided in `use-counted.ts` and shared with the Aptabase shim.
 */

import { createContext, useContext, type ReactNode } from "react";
import { useCounted, type CountedCallbacks, type CountedConfig, type CountedHandle } from "./use-counted";

const AnalyticsContext = createContext<CountedHandle | null>(null);

export type AnalyticsProviderProps = Omit<CountedConfig, "key"> &
  CountedCallbacks & {
    /**
     * Your public ingest key.
     *
     * Named `projectKey` rather than the SDK's `key` because `key` is reserved
     * by React: `<AnalyticsProvider key="ck_live_…">` would be consumed as a
     * list key, never reach this component, and construct a client with no
     * credential at all.
     */
     readonly projectKey: string;
    readonly children: ReactNode;
  };

/**
 * ```tsx
 * <AnalyticsProvider projectKey="ck_live_…">
 *   <App />
 * </AnalyticsProvider>
 * ```
 *
 * Changing any option rebuilds the client and flushes whatever the old one
 * still held. Re-rendering with the same options does not.
 */
export function AnalyticsProvider({
  children,
  projectKey,
  fetch,
  now,
  random,
  onDiagnostic,
  ...rest
}: AnalyticsProviderProps) {
  const handle = useCounted({ ...rest, key: projectKey }, { fetch, now, random, onDiagnostic });
  return <AnalyticsContext.Provider value={handle}>{children}</AnalyticsContext.Provider>;
}

/** `{ track, identify, reset, flush }`. Stable across renders. */
export function useAnalytics(): CountedHandle {
  const context = useContext(AnalyticsContext);
  if (context === null) {
    throw new Error("useAnalytics must be used within <AnalyticsProvider>");
  }
  return context;
}
