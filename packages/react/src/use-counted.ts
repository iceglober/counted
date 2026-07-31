/**
 * The one place a `Counted` instance is tied to a React lifecycle.
 *
 * Both providers are built on this, because the two of them drifting is the
 * bug: `AnalyticsProvider` constructed its client with a `[]` dependency list
 * and so ignored a changed key forever, while `AptabaseProvider` — the compat
 * shim, the one nobody was supposed to look at — got it right. One
 * implementation means there is nothing left to disagree.
 */

import { useEffect, useMemo, useRef } from "react";
import { Counted, type CountedOptions, type PropertyValue } from "@counted/sdk-js";

export type { PropertyValue };

/** The seams. Functions, so they can never be part of a dependency value. */
export type CountedCallbacks = {
  // Explicitly `| undefined`, because a provider destructures these out of its
  // props and hands over whatever was there — usually nothing.
  readonly [K in "fetch" | "now" | "random" | "onDiagnostic"]?: CountedOptions[K] | undefined;
};

/**
 * Everything whose *value* decides which client you get.
 *
 * The complement of the callbacks, so the two halves cover the options exactly
 * and adding an option to the SDK puts it on this side by default — the safe
 * side, the one that triggers a rebuild.
 */
export type CountedConfig = LooseOptional<Omit<CountedOptions, keyof CountedCallbacks>>;

/**
 * Lets an *optional* property be passed as an explicit `undefined`, and leaves
 * required ones alone.
 *
 * React props are routinely `string | undefined` — `appVersion={process.env.X}`
 * — and under `exactOptionalPropertyTypes` the SDK's own options refuse that.
 * Loosening only the optional half means `projectKey` still cannot go missing.
 */
type LooseOptional<T> = { readonly [K in keyof T]: undefined extends T[K] ? T[K] | undefined : T[K] };

export type CountedHandle = {
  readonly track: (name: string, properties?: Readonly<Record<string, PropertyValue>>) => void;
  readonly identify: (userId: string) => void;
  readonly reset: () => void;
  readonly flush: () => Promise<void>;
};

/**
 * Calls made before an instance exists — during SSR, or on the render before
 * the effect runs. Held in one list rather than one per method so that
 * `identify()` then `track()` replays in that order; replaying them by kind
 * would attribute the event to nobody.
 */
type PendingCall =
  | { readonly kind: "track"; readonly name: string; readonly properties: Readonly<Record<string, PropertyValue>> | undefined }
  | { readonly kind: "identify"; readonly userId: string }
  | { readonly kind: "reset" };

/**
 * A stable string for a config, computed from the object rather than from a
 * hand-listed set of field names.
 *
 * A list of option names sitting beside the option type is a list that goes
 * stale, and the way it goes stale is a new option the provider silently
 * ignores at runtime — which is the class of bug this file exists to fix. So
 * nothing here knows what the options are called.
 *
 * Keys are sorted so prop order does not matter, and `undefined` entries are
 * dropped so `{key, endpoint: undefined}` and `{key}` are the same client.
 */
const identityOf = (config: CountedConfig): string =>
  JSON.stringify(
    Object.entries(config as Record<string, unknown>)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );

/**
 * Drops keys whose value is `undefined`.
 *
 * A destructured prop that was never passed is present-and-undefined, and the
 * SDK's options refuse that under `exactOptionalPropertyTypes` — correctly, since
 * `{fetch: undefined}` and `{}` should not be different requests to make.
 */
const defined = <T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

/** Mirrors what the SDK does with the argument, so the two agree on "nobody". */
const normalizePerson = (userId: string): string | null => {
  const trimmed = userId.trim();
  return trimmed.length === 0 ? null : trimmed;
};

export const useCounted = (config: CountedConfig, callbacks: CountedCallbacks = {}): CountedHandle => {
  const instanceRef = useRef<Counted | null>(null);
  const pendingRef = useRef<PendingCall[]>([]);
  /**
   * Survives a rebuild. A changed key is a configuration change, not a
   * sign-out: the person who was identified a moment ago is still the person,
   * and starting the new client anonymous would silently orphan their events.
   */
  const personRef = useRef<string | null>(null);
  const callbacksRef = useRef(callbacks);
  const configRef = useRef(config);
  configRef.current = config;

  // Declared before the effect below so that on first mount the current
  // callbacks are in place before anything is constructed.
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  /**
   * The one path a call takes to a client, whether it was made now or queued.
   *
   * `personRef` is written here rather than at the call site so it records
   * what a client has actually been told — which is what makes it safe to
   * re-apply on the next one.
   */
  const apply = (instance: Counted, call: PendingCall): void => {
    if (call.kind === "track") {
      instance.track(call.name, call.properties);
      return;
    }
    if (call.kind === "identify") {
      personRef.current = normalizePerson(call.userId);
      instance.identify(call.userId);
      return;
    }
    personRef.current = null;
    instance.reset();
  };

  const identity = identityOf(config);

  useEffect(() => {
    // Never on the server: an instance per request would leak a timer and a
    // `visibilitychange` listener per request.
    if (typeof window === "undefined") return;

    // Read through the ref, so a caller passing an inline `{...}` of options
    // does not rebuild on every render — `identity` already decided that.
    const instance = new Counted(defined({ ...configRef.current, ...callbacksRef.current }));
    instanceRef.current = instance;

    // Whoever was identified against the *previous* instance, re-applied
    // before anything else. `personRef` only ever records a call that reached
    // a live client, so a queued `identify` is not double-counted here — it
    // arrives in the replay below, in its place among the tracks.
    if (personRef.current !== null) instance.identify(personRef.current);

    for (const call of pendingRef.current) apply(instance, call);
    pendingRef.current = [];

    return () => {
      instanceRef.current = null;
      // Flushes what is queued under the credential it was queued for. Events
      // tracked before the key changed belong to the old project.
      void instance.shutdown();
    };
    // `identity` is the value of every config option, so a changed key — or a
    // changed endpoint, or app version — rebuilds, and a re-render with the
    // same values does not.
  }, [identity]);

  const send = (call: PendingCall): void => {
    const instance = instanceRef.current;
    if (instance !== null) apply(instance, call);
    else pendingRef.current.push(call);
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  return useMemo<CountedHandle>(
    () => ({
      track: (name, properties) => sendRef.current({ kind: "track", name, properties }),
      identify: (userId) => sendRef.current({ kind: "identify", userId }),
      reset: () => sendRef.current({ kind: "reset" }),
      flush: async () => {
        await instanceRef.current?.flush();
      },
    }),
    // Stable for the provider's lifetime: every method reads the current
    // instance through a ref, so a rebuild does not re-render every consumer.
    [],
  );
};
