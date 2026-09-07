/**
 * @counted/ingestion-ports — the three things the hot path needs from outside.
 *
 * Where admitted events go, what stops them, and the one fact about a request
 * that is not in the request body.
 */

export * from "./event-sink";
export * from "./geo-locator";
export * from "./ingest-quota";
