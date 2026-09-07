/**
 * What a dashboarding use case needs, and the one type parameter it cannot
 * close.
 *
 * V3-SPEC §5 says a context closes its repository type parameters here, once,
 * so every consumer spells the same alias. Dashboarding closes the *aggregate*
 * and the *event union* — but not the analysis. `A` is the analytics context's
 * Analysis IR and this layer may import any ports package but not another
 * context's domain, so there is nothing here to close it *to*. It stays open until the
 * composition root, which is the only place that legitimately knows both
 * contexts. That is one type parameter on each alias below and no other cost;
 * the alternative — promoting the Analysis IR into the kernel as a shared
 * kernel — changes the dependency boundaries and requires updating their rules.
 */

import type { Clock, IdGenerator } from "@counted/kernel/ports";
import type { Result } from "@counted/kernel";
import type { Dashboard, DashboardEvent, Monitor, MonitorError, MonitorEvent } from "@counted/dashboarding-domain";
import type {
  DashboardRepository as DashboardRepositoryPort,
  MonitorRepository as MonitorRepositoryPort,
  ShareTokens,
} from "@counted/dashboarding-ports";

export type DashboardRepository<A> = DashboardRepositoryPort<Dashboard<A>, DashboardEvent>;
export type MonitorRepository<A> = MonitorRepositoryPort<Monitor<A>, MonitorEvent>;

/**
 * "This analysis produces a single number a threshold can be compared against."
 *
 * A real rule, and not one this context can answer: it means reading the
 * Analysis IR, which lives in another context's domain. So it arrives as a
 * function, supplied by the composition root over `@counted/analytics-domain`,
 * and returns the `AnalysisMustBeScalar` / `InvalidAnalysis` kinds
 * `@counted/dashboarding-domain` declares for exactly this purpose.
 *
 * A monitor whose analysis groups by anything yields a row per group, and there
 * is nothing to compare. v1 could not even express the constraint, because
 * alerts had their own vocabulary with no notion of grouping.
 */
export type AnalysisCheck<A> = (analysis: A) => Result<A, MonitorError>;

/**
 * Every dashboard use case takes this. `clock` is here rather than in each
 * signature because a use case is the layer that is *allowed* to read the time
 * — the domain is handed the `Instant` it acts at, which is what keeps its
 * tests free of a frozen clock.
 */
export type DashboardDeps<A> = {
  readonly dashboards: DashboardRepository<A>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly shareTokens: ShareTokens;
};

export type MonitorDeps<A> = {
  readonly monitors: MonitorRepository<A>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly isScalar: AnalysisCheck<A>;
};
