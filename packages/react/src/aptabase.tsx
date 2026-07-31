/**
 * Drop-in replacements for `@aptabase/react`.
 *
 * The whole point is that a migrating app changes its import and nothing else,
 * so the prop shape is Aptabase's — `appKey`, `options.appVersion`,
 * `options.host` — and the translation happens here.
 *
 * Built on the same `useCounted` as the real provider. When these two had
 * separate lifecycles, this one handled a changed `appKey` and the real
 * provider did not; sharing the hook is what stops that recurring.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useCounted, type CountedHandle, type PropertyValue } from "./use-counted";

type AptabaseContextValue = {
  readonly trackEvent: (eventName: string, props?: Readonly<Record<string, PropertyValue>>) => void;
};

const AptabaseContext = createContext<CountedHandle | null>(null);

export type AptabaseOptions = {
  /** App version reported in system properties. */
  readonly appVersion?: string;
  /** Ingestion base URL. Default: Counted's. */
  readonly host?: string;
};

/**
 * `appKey` maps to Counted's ingest key.
 *
 * ```tsx
 * <AptabaseProvider appKey="A-US-0000000000" options={{ appVersion: "1.0.0" }}>
 *   <App />
 * </AptabaseProvider>
 * ```
 */
export function AptabaseProvider({
  appKey,
  options,
  children,
}: {
  readonly appKey: string;
  readonly options?: AptabaseOptions;
  readonly children: ReactNode;
}) {
  const handle = useCounted({
    key: appKey,
    // Aptabase names a host; the SDK wants the endpoint on it.
    ...(options?.host === undefined ? {} : { endpoint: `${options.host.replace(/\/+$/, "")}/v1/events` }),
    ...(options?.appVersion === undefined ? {} : { appVersion: options.appVersion }),
  });
  return <AptabaseContext.Provider value={handle}>{children}</AptabaseContext.Provider>;
}

/**
 * Returns `{ trackEvent }`, Aptabase's shape.
 *
 * `identify`/`reset` are deliberately absent: Aptabase has no such call, so an
 * app still using this hook has not been ported yet. Reach for `useAnalytics`
 * when it has.
 */
export function useAptabase(): AptabaseContextValue {
  const context = useContext(AptabaseContext);
  if (context === null) {
    throw new Error("useAptabase must be used within <AptabaseProvider>");
  }
  // Memoized: `context.track` is stable, so a consumer can put `trackEvent`
  // in a dependency array without re-running every render.
  return useMemo(() => ({ trackEvent: context.track }), [context.track]);
}
