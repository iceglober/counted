/**
 * @counted/projects-domain — the Project aggregate, and every rule about
 * credentials.
 *
 * better-auth owns the credential rows. This package owns
 * what may be done with them, as pure functions over facts the caller loaded:
 *
 *   "you may not revoke your last usable ingest key"      `mayRevoke`
 *   "an ingest key carries exactly events:write"          `INGEST_PERMISSIONS`
 *   "no key may out-rank its issuer" (Q3)                 `grantableTo`
 *   what state a key is in — active/expiring/revoked/expired, derived once
 *                                                          `credentialStatus`
 *
 * The rotation *window* is not here. How long the outgoing secret keeps working
 * is a product decision, and it lives in `@counted/projects-app` beside the use
 * case that spends it.
 */

export * from "./credential";
export * from "./errors";
export * from "./events";
export * from "./grant";
export * from "./project";
export * from "./retention";
export * from "./suggested-name";
