/**
 * @counted/adapter-postgres — the Postgres implementation of the storage ports.
 *
 * Plain PostgreSQL. TimescaleDB is optional and detected at boot (#40); no
 * query depends on it, because bucketing was removed from SQL entirely — the
 * domain computes edges and this adapter assigns rows to them.
 */

export * from "./sql/schema";
export * from "./partitions";
export * from "./sql/indexes";
export * from "./pool";
export * from "./compile/params";
export * from "./compile/numeric";
export * from "./compile/column-map";
export * from "./compile/predicate";
export * from "./compile/measure";
export * from "./compile/statements";
export * from "./compile/sequence";
