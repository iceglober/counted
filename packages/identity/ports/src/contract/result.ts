/**
 * Two unwrappers the suites share.
 *
 * `expect(r.ok).toBe(true)` narrows nothing, so every assertion after it needs
 * a cast; these throw instead, and the message carries the outcome that was
 * not expected. A contract suite that fails should name what the adapter
 * actually returned — otherwise the adapter author is left bisecting.
 */

import type { Result } from "@counted/kernel";

export const expectOk = <T, E>(r: Result<T, E>, what: string): T => {
  if (!r.ok) throw new Error(`${what}: expected ok, got error ${JSON.stringify(r.error)}`);
  return r.value;
};

export const expectErr = <T, E>(r: Result<T, E>, what: string): E => {
  if (r.ok) throw new Error(`${what}: expected an error, got ok ${JSON.stringify(r.value)}`);
  return r.error;
};
