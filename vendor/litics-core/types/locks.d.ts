/**
 * Advisory-lock keys, in one place so nothing else in the database picks them
 * by accident.
 *
 * Postgres advisory locks share one keyspace per database, and the bigint form
 * and the two-int form are *separate* keyspaces (they set different lock-tag
 * fields). litics uses the two-int form for every runtime lock and the bigint
 * form for exactly one thing — its own migrator — so a host application's
 * bigint schema lock (Counted's is `6_284_197_305_412`) can never collide with
 * a litics runtime lock even in principle, and litics' own keys stay grouped
 * under one class.
 *
 * Every runtime lock is transaction-scoped (`pg_try_advisory_xact_lock`). A
 * replica that dies holding one releases it when its transaction aborts, so
 * there is nothing to clean up after a crash — the rows it was packing are
 * still in staging and the next tick packs them.
 */
/** bigint form. Held while applying migrations. Never used at runtime. */
export declare const LITICS_SCHEMA_LOCK_KEY = 5192366400217;
/**
 * int4 form, first key of every runtime lock. The second key says what is
 * locked: `hashtext(tenant_id)` for pack/merge/purge on one tenant, `0` for
 * staging partition DDL.
 */
export declare const LITICS_LOCK_CLASS = 811774301;
/** Second key for the staging-partition DDL lock. */
export declare const STAGING_DDL_LOCK = 0;
