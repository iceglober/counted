/**
 * Both pairs, from one entry point.
 *
 * `@counted/react/aptabase` still resolves, for apps that migrated by changing
 * one import path — but a package that exports half its surface from a subpath
 * nobody mentions is a package whose second half rots. It rotted: the compat
 * provider handled a changed key and the real one did not, for four releases.
 */

export { AnalyticsProvider, useAnalytics, type AnalyticsProviderProps } from "./provider";
export { AptabaseProvider, useAptabase, type AptabaseOptions } from "./aptabase";
export {
  useCounted,
  type CountedCallbacks,
  type CountedConfig,
  type CountedHandle,
  type PropertyValue,
} from "./use-counted";
