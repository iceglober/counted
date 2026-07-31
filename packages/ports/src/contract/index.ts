/**
 * Adapter contract suites.
 *
 * An adapter is not "done" when its own tests pass. It is done when it passes
 * these, which are written once and run against every implementation.
 *
 * Wire them into any runner:
 *
 *     import { allStoreContracts } from "@counted/ports/contract";
 *     for (const c of allStoreContracts) test(c.name, () => c.run(fixture));
 *
 * The suites carry no test-framework dependency, so `packages/ports` stays
 * importable from anywhere and the same suite can verify a Postgres adapter
 * today and a ClickHouse one later without being rewritten.
 */

export * from "./harness";
export * from "./fixtures";
export { analyticalStoreContract } from "./analytical-store.contract";
export { bucketDifferentialContract } from "./bucket-differential.contract";
export { eventWriterContract } from "./event-writer.contract";

import { analyticalStoreContract } from "./analytical-store.contract";
import { bucketDifferentialContract } from "./bucket-differential.contract";
import { eventWriterContract } from "./event-writer.contract";
import type { StoreFixture } from "./fixtures";
import type { ContractCase } from "./harness";

/** Everything a store-plus-writer adapter must satisfy. */
export const allStoreContracts: readonly ContractCase<StoreFixture>[] = [
  ...eventWriterContract,
  ...analyticalStoreContract,
  ...bucketDifferentialContract,
];
