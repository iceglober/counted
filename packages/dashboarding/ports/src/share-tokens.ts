/**
 * ShareTokens — minting and digesting a share link's secret.
 *
 * A separate port from the repository because it is the one place in
 * dashboarding that needs randomness and a hash, and neither may live in a
 * domain (`domain-is-pure`). `@counted/adapter-crypto` implements it; the
 * domain only ever sees the digest.
 *
 * Both halves matter. `mint` returns the token *once* — it is put in a URL and
 * never stored, so a database read cannot hand anyone a working link. `digest`
 * is what turns a token presented on the share page back into something
 * `DashboardRepository.findByShareDigest` can look up.
 */

export type MintedShareToken = {
  /** Shown to the customer once, put in the URL, never persisted. */
  readonly token: string;
  /** What is persisted on the dashboard. */
  readonly digest: string;
};

export interface ShareTokens {
  mint(): Promise<MintedShareToken>;

  /**
   * Must be deterministic and must not be reversible. A keyed digest is fine; a
   * salted-per-call one is not, because the lookup would have nothing to match.
   */
  digest(token: string): Promise<string>;
}
