/**
 * Two unwrappers the tenancy contract suites share.
 *
 * `expect(r.ok).toBe(true)` narrows nothing, so every assertion after it needs
 * a cast; these throw instead, and the message carries the outcome that was
 * not expected. A contract suite that fails should name what the adapter
 * actually returned rather than leaving its author to bisect.
 *
 * Copied in shape from `@counted/identity-ports/contract` rather than shared
 * with it: a helper that two contexts both imported would be a fourth package
 * for eight lines, and the identity one may not be reached from here anyway
 * (`app-knows-only-its-domain-kernel-and-ports` allows the ports package, not
 * its contract subpath's private helpers).
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
