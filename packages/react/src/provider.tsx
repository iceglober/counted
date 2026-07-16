import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Analytics, type AnalyticsOptions, type EventProperties } from "@counted/sdk";

type AnalyticsContextValue = {
  track: (eventName: string, props?: EventProperties) => void;
  register: (props: EventProperties) => void;
};

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

type QueuedCall =
  | { type: "track"; eventName: string; props?: EventProperties }
  | { type: "register"; props: EventProperties };

export function AnalyticsProvider({
  children,
  ...options
}: AnalyticsOptions & { children: ReactNode }) {
  const analyticsRef = useRef<Analytics | null>(null);
  // Calls made before the instance exists (or during SSR) are queued and
  // replayed once the effect constructs it.
  const queueRef = useRef<QueuedCall[]>([]);

  useEffect(() => {
    // SSR guard: never construct Analytics on the server (no timers/listeners
    // leaked per request). This also drives the StrictMode-safe lifecycle:
    // mount → cleanup (destroy + null ref) → mount recreates a live instance.
    if (typeof window === "undefined") return;

    const instance = new Analytics(options);
    analyticsRef.current = instance;

    for (const call of queueRef.current) {
      if (call.type === "track") instance.track(call.eventName, call.props);
      else instance.register(call.props);
    }
    queueRef.current = [];

    return () => {
      analyticsRef.current = null;
      void instance.destroy();
    };
    // Construct once for the provider's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AnalyticsContextValue>(
    () => ({
      track: (eventName, props) => {
        if (analyticsRef.current) analyticsRef.current.track(eventName, props);
        else queueRef.current.push({ type: "track", eventName, props });
      },
      register: (props) => {
        if (analyticsRef.current) analyticsRef.current.register(props);
        else queueRef.current.push({ type: "register", props });
      },
    }),
    [],
  );

  return (
    <AnalyticsContext.Provider value={value}>
      {children}
    </AnalyticsContext.Provider>
  );
}

export function useAnalytics(): AnalyticsContextValue {
  const ctx = useContext(AnalyticsContext);
  if (!ctx) {
    throw new Error("useAnalytics must be used within <AnalyticsProvider>");
  }
  return ctx;
}
