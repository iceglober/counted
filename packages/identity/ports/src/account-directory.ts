/**
 * AccountDirectory — reading who somebody is.
 *
 * The domain is Conformist to Identity: it accepts
 * better-auth's user id as given, does not re-model it, and never mints its
 * own. This port is read-only for that reason — sign-up, sign-in, password
 * reset and social linking all happen through better-auth's own HTTP surface,
 * not through us. What the domain needs is narrower: an email address to
 * notify, a name to render, and the ability to say "no such account" when a
 * membership row points at nothing.
 */

import type { AccountId, Instant } from "@counted/kernel";

export type Account = {
  readonly id: AccountId;
  readonly email: string;
  /** Null until the human sets one. Rendered as the email when absent. */
  readonly name: string | null;
  /**
   * Whether better-auth has confirmed the address. Read it before sending
   * anything the recipient did not ask for; an unverified address is somebody
   * else's until proven otherwise.
   */
  readonly emailVerified: boolean;
  readonly createdAt: Instant;
};

export interface AccountDirectory {
  /**
   * One account, or null if there is none. Absence is not an error: a
   * membership row can outlive the account it points at, and the caller that
   * renders a member list has to survive that.
   */
  find(id: AccountId): Promise<Account | null>;

  /**
   * Case-insensitive, because that is how the address was typed on a phone.
   *
   * Returns null for an unknown address rather than throwing — "is there an
   * account here" is a question the invitation flow asks routinely and the
   * answer "no" is not an error. Must agree with `find`: the account this
   * returns is the same one `find` returns for its id.
   */
  findByEmail(email: string): Promise<Account | null>;

  /**
   * Several accounts at once, for rendering a member list without one query
   * per row.
   *
   * Missing ids are **absent from the map**, never present as null entries: a
   * caller that iterates the map cannot then forget to handle the hole. Every
   * key in the result is one of the requested ids, duplicates in the input
   * collapse, and an empty input is an empty map rather than a round trip.
   */
  findMany(ids: readonly AccountId[]): Promise<ReadonlyMap<AccountId, Account>>;
}
