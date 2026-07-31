/**
 * Subject — who or what an event is attributed to.
 *
 * Every event has a visit. Some also carry a person, because the customer
 * called `identify()`. That difference is what decides which questions are
 * answerable, so it is modelled explicitly rather than left as a nullable
 * column that analysis code forgets to check.
 *
 * `CountingBasis` is the query-side half. A question either counts visits or
 * counts people, and some questions are only honest on one of them:
 *
 *   - counts, time series, breakdowns   → either basis
 *   - funnels                           → either (visit-scoped is the default)
 *   - retention across days or weeks    → person only
 *
 * v1 offered retention on the visit basis. Since visits expire after 30 minutes
 * idle, every cohort past period 0 was structurally ~0, and the column was
 * labelled "Users". Here that combination cannot be constructed.
 */

import { assertNever } from "../shared/brand";
import type { PersonId } from "./person";
import type { VisitId } from "./visit";

export type Subject =
  | { readonly basis: "visit"; readonly visit: VisitId }
  | { readonly basis: "person"; readonly visit: VisitId; readonly person: PersonId };

export const Subject = {
  anonymous: (visit: VisitId): Subject => ({ basis: "visit", visit }),

  identified: (visit: VisitId, person: PersonId): Subject => ({
    basis: "person",
    visit,
    person,
  }),

  /** Every subject has a visit; that part is never optional. */
  visitOf: (s: Subject): VisitId => s.visit,

  personOf: (s: Subject): PersonId | null => (s.basis === "person" ? s.person : null),

  isIdentified: (s: Subject): boolean => s.basis === "person",
} as const;

export type CountingBasis = "visit" | "person";

export const CountingBasis = {
  label: (b: CountingBasis): string => {
    switch (b) {
      case "visit":
        return "visits";
      case "person":
        return "people";
      default:
        return assertNever(b);
    }
  },

  /**
   * Whether a basis can answer questions that span visits. Retention and
   * cross-visit funnels need this; nothing else does.
   */
  spansVisits: (b: CountingBasis): boolean => b === "person",
} as const;
