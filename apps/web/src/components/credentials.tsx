/**
 * A project's keys.
 *
 * Two things this deliberately never shows: a secret, and a guess.
 *
 * The secret appears exactly once, at issue or rotation, and is not stored —
 * only its digest is. So there is nothing to display here and no "reveal"
 * control to build. v1 stored keys in plaintext across three columns and
 * showed them on demand.
 *
 * A revoked key stays in the list, struck through, rather than disappearing.
 * A key that vanishes is indistinguishable from one that was never created,
 * which is the wrong thing to tell somebody debugging a 401.
 */

import type { ReactElement } from "react";

export type Credential = {
  readonly id: string;
  readonly kind: "ingest" | "service";
  readonly label: string;
  /** Enough to tell two keys apart in a list. Not enough to authenticate. */
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly revokedAt?: string | null;
};

export const CredentialTable = ({ credentials }: { credentials: readonly Credential[] | null }): ReactElement => {
  // `null` is a failed lookup, not an empty one. Rendering "no keys" for a
  // request that never answered is the same class of lie as an empty chart.
  if (credentials === null) {
    return (
      <p className="tile-error" role="alert">
        The keys for this project could not be listed.
      </p>
    );
  }

  if (credentials.length === 0) {
    return <p className="tile-empty">No keys yet. Issue one to start sending events.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Label</th>
          <th>Kind</th>
          <th>Prefix</th>
          <th>Scopes</th>
        </tr>
      </thead>
      <tbody>
        {credentials.map((credential) => {
          const revoked = credential.revokedAt !== null && credential.revokedAt !== undefined;
          return (
            <tr key={credential.id} style={revoked ? { color: "var(--text-tertiary)" } : undefined}>
              <td>
                {revoked ? <s>{credential.label}</s> : credential.label}
                {revoked && <span className="tile-empty"> · revoked</span>}
              </td>
              <td>
                {credential.kind}
                {/* Said plainly, because the two are handled differently and
                    the difference is not obvious from a prefix. */}
                {credential.kind === "ingest" && <span className="tile-empty"> · public, safe to embed</span>}
              </td>
              <td style={{ fontFamily: "var(--font-mono)" }}>{credential.prefix}…</td>
              <td>{credential.scopes.join(", ")}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
