/**
 * better-auth's `member.role` string, as a domain `Role`.
 *
 * The organization plugin stores a role as free text and supports several at
 * once by comma-separating them. The domain has exactly three, ordered. This
 * file is the whole anti-corruption layer between those two facts.
 *
 * **An unrecognised role reads as "not a member", not as "member".** A row
 * saying `role: "billing-viewer"` is a row this system has no rule for, and
 * the safe reading of a rule you do not have is no authority at all. Defaulting
 * such a row to `member` would hand a stranger the member grant because
 * somebody typed a role name into the database.
 */

import { ROLES, Role } from "@counted/kernel";

const KNOWN = new Set<string>(ROLES);

/**
 * The strongest role in a better-auth role string, or null if it names none we
 * know.
 *
 * Strongest rather than first: better-auth's own permission check succeeds if
 * *any* of the comma-separated roles authorizes the action, so reading the
 * weakest would make this directory disagree with the vendor about the same
 * row — and a member list that shows less authority than the system actually
 * grants is worse than one that shows more.
 */
export const roleFrom = (raw: string | null | undefined): Role | null => {
  if (typeof raw !== "string") return null;
  let best: Role | null = null;
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (!KNOWN.has(name)) continue;
    const candidate = name as Role;
    if (best === null || Role.rank(candidate) > Role.rank(best)) best = candidate;
  }
  return best;
};

/** The string better-auth should store for a domain role. */
export const roleTo = (role: Role): string => role;
