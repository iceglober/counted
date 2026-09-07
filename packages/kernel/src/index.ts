/**
 * @counted/kernel — the vocabulary every context shares, and nothing else.
 *
 * Zero dependencies, by rule and by fact. If something here needed an npm
 * package it would not belong here.
 *
 * `./ports` is deliberately NOT re-exported from this entry point. Clock,
 * IdGenerator and Notifier are capabilities, and a domain package that can
 * reach them by importing the kernel root would lose the property that makes
 * it testable. Import `@counted/kernel/ports` explicitly, from a layer allowed
 * to have capabilities.
 */

export * from "./brand";
export * from "./result";
export * from "./duration";
export * from "./instant";
export * from "./ids";
export * from "./events";
export * from "./authz";
