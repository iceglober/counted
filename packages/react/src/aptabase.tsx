import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Analytics, type EventProperties } from "@counted/sdk";

type AptabaseContextValue = {
  trackEvent: (eventName: string, props?: EventProperties) => void;
};

const AptabaseContext = createContext<AptabaseContextValue | null>(null);

type AptabaseOptions = {
  /** App version reported in system props. */
  appVersion?: string;
  /** Ingestion host. Default: `https://app.counted.dev`. */
  host?: string;
};

/**
 * Drop-in replacement for `@aptabase/react`'s `AptabaseProvider`.
 * `appKey` maps to Counted's `projectKey`.
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
  appKey: string;
  options?: AptabaseOptions;
  children: ReactNode;
}) {
  const ref = useRef<Analytics | null>(null);
  const queueRef = useRef<Array<{ eventName: string; props?: EventProperties }>>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const instance = new Analytics({
      projectKey: appKey,
      appVersion: options?.appVersion,
      host: options?.host,
    });
    ref.current = instance;

    for (const call of queueRef.current) instance.track(call.eventName, call.props);
    queueRef.current = [];

    return () => {
      ref.current = null;
      void instance.destroy();
    };
    // Reconstruct if the app key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appKey]);

  const value = useMemo<AptabaseContextValue>(
    () => ({
      trackEvent: (eventName, props) => {
        if (ref.current) ref.current.track(eventName, props);
        else queueRef.current.push({ eventName, props });
      },
    }),
    [],
  );

  return <AptabaseContext.Provider value={value}>{children}</AptabaseContext.Provider>;
}

/**
 * Drop-in replacement for `@aptabase/react`'s `useAptabase`.
 * Returns `{ trackEvent }`.
 */
export function useAptabase(): AptabaseContextValue {
  const ctx = useContext(AptabaseContext);
  if (!ctx) {
    throw new Error("useAptabase must be used within <AptabaseProvider>");
  }
  return ctx;
}
