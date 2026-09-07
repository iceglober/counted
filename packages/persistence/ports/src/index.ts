/**
 * @counted/persistence-ports — the transaction boundary, and what crosses it.
 *
 * This is the one ports package that belongs to no bounded context, because a
 * transaction is the thing contexts share when a single command touches more
 * than one of them.
 */

export * from "./unit-of-work";
export * from "./outbox";
