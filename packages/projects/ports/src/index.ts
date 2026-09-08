/**
 * @counted/projects-ports — what the Project aggregate needs from outside.
 *
 * Notably absent: anything about credentials. The rows belong to better-auth's
 * api-key plugin and are reached through `CredentialStore` in
 * `@counted/identity-ports`; what stays here is the aggregate that the rules
 * about those credentials hang off.
 */

export * from "./project-repository";
