import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { Analytics, type AnalyticsOptions, type EventProperties } from "@counted/sdk";

type AnalyticsContextValue = {
  track: (eventName: string, props?: EventProperties) => void;
};

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

export function AnalyticsProvider({
  children,
  ...options
}: AnalyticsOptions & { children: ReactNode }) {
  const analyticsRef = useRef<Analytics | null>(null);

  if (!analyticsRef.current) {
    analyticsRef.current = new Analytics(options);
  }

  useEffect(() => {
    return () => {
      analyticsRef.current?.destroy();
    };
  }, []);

  const value: AnalyticsContextValue = {
    track: (eventName, props) => analyticsRef.current?.track(eventName, props),
  };

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
