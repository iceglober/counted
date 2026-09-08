/** Shared pieces of every read: parameters, the tenancy predicate, filter and group-by checks. */
import type { PoolClient } from "pg";
import type { ResolvedConfig, ResolvedStream } from "../config.js";
export declare class Params {
    readonly values: unknown[];
    add(value: unknown): string;
}
export declare const findStream: (cfg: ResolvedConfig, name: string) => ResolvedStream;
/** A dimension's position in the stream's declared list — what `_summary_dims.dim` holds. */
export declare const dimOrdinal: (st: ResolvedStream, name: string) => number;
/** The dictionary a dimension's values live in; event types are namespaced per stream. */
export declare const dimDict: (st: ResolvedStream, dim: string) => string;
export declare const assertEventType: (st: ResolvedStream, type: string) => void;
/** A column a read may filter or group by: `event_type` or a declared dimension. */
export declare const assertSliceable: (st: ResolvedStream, name: string, what: string) => void;
/**
 * The tenancy predicate, mirroring the generated RLS policy so isolation
 * holds on owner connections too. Primary enforcement; RLS is the backstop.
 */
export declare const scopePredicate: (cfg: ResolvedConfig, alias: string, p: Params, scope: string | number | bigint | undefined) => string;
/**
 * Resolve allowed strings to dictionary ids in one query. Unknown members of
 * a set are ignored; an empty set matches nothing, never every value.
 */
export declare const resolveFilterIds: (client: PoolClient, cfg: ResolvedConfig, st: ResolvedStream, filters: Readonly<Record<string, string | readonly string[]>> | undefined) => Promise<Map<string, readonly number[]> | null>;
/** Dictionary ids → the strings they stand for; 0 (the null sentinel) → null. */
export declare const resolveValues: (client: PoolClient, cfg: ResolvedConfig, st: ResolvedStream, dim: string, ids: Iterable<number>) => Promise<Map<number, string | null>>;
