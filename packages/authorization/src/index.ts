/**
 * @counted/authorization — the three questions.
 *
 *   Q1  does this role have this permission          `permits`, in grants.ts
 *   Q2  is this resource inside this principal's reach `covers`, in placement.ts
 *   Q3  may this issuer grant what it is granting     NOT HERE — see below
 *
 * `decide` answers Q1 and Q2 together and is what a route calls;
 * `decideUnplaced` answers Q1 alone for the routes that have no resource to
 * place, so the app layer never invents a check of its own.
 *
 * **Q3 lives in `@counted/projects-domain`** (`withinGrant`, `grantableTo`),
 * and is stated exactly once. This
 * package used to hold a second version of it — `grantable(role, requested)`,
 * called by nothing — which was the same rule reached from the other end and
 * missing the credential-kind ceiling. Two statements of one rule with nothing
 * comparing them is the defect this package exists to prevent, so the copy is
 * gone. The composition is `withinGrant(requested, permissionsForRole(role))`:
 * this package turns a role into permissions, that one enforces the subset,
 * and `apps/*` joins them.
 *
 * The vocabulary — `Role`, `Permission`, `ALL_PERMISSIONS` — lives in
 * `@counted/kernel`, because `@counted/contract` needs it to emit OpenAPI
 * `security` blocks and the contract is a leaf that may import only the
 * kernel. The kernel says what the words are; this package says who gets what.
 *
 * Use cases do not import this package (`.dependency-cruiser.cjs`, rule 2).
 * The decision runs in `apps/*` before the use case; a use case that re-checked
 * would be a second policy, and two policies means one of them is wrong.
 */

export * from "./grants";
export * from "./principal";
export * from "./placement";
export * from "./decide";
