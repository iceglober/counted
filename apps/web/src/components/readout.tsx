import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@counted/ui/components/alert";
import { Empty } from "./notice";
import { InsightTable } from "./insight-table";
/**
 * One tile's answer, or a stated reason there is none. Never a silent blank.
 *
 * `Readout` is discriminated on `ok` and its failure branch names the engine's
 * own four kinds, so "no events in this window" and "the query died" cannot
 * render the same way. v1 returned an empty series for both and they came out
 * as the same flat line.
 *
 * The empty check is here, above the chart, rather than inside it: a series of
 * zeros is not something to draw and then apologise for, and `SeriesChart`
 * therefore never receives one in production.
 */
import type { ContractOutputs } from "../lib/client";
import { measured } from "../lib/format";
import { SeriesChart } from "./series-chart";
import { BreakdownChart } from "./breakdown-chart";
import { BreakdownTable } from "./breakdown-table";
type Readout = ContractOutputs["dashboards"]["readouts"]["readouts"][number];
type ReadoutValue = Extract<
  Readout,
  {
    ok: true;
  }
>["value"];
type Trend = NonNullable<
  Extract<
    ReadoutValue,
    {
      shape: "scalar";
    }
  >["trend"]
>;
/** Nothing measured is a different fact from nothing returned. */
const isEmpty = (value: ReadoutValue): boolean => {
  switch (value.shape) {
    case "scalar":
      return false;
    case "series":
      return value.series
        ? value.series.every((series) =>
            series.points.every((point) => point.value === 0),
          )
        : value.points.every((point) => point.value === 0);
    case "breakdown":
      return value.rows.length === 0;
    case "funnel":
      return value.result.steps.length === 0;
  }
};
/**
 * `percentChange` is null when the previous window had no events, and it is
 * rendered as "no comparison" rather than as 0% or ∞. There is no percentage
 * change from nothing, and every number you could put there is a lie a
 * dashboard renders as a badge.
 */
const TrendNote = ({ trend }: { readonly trend: Trend }) => (
  <p className="mt-3 text-xs text-muted-foreground">
    {trend.percentChange === null
      ? `no comparison — the previous window had ${measured(trend.previous)}`
      : `${trend.direction === "down" ? "−" : trend.direction === "up" ? "+" : "±"}${Math.abs(trend.percentChange).toFixed(1)}% vs ${measured(trend.previous)}`}
  </p>
);
const Value = ({
  value,
  label,
  view,
  analysis,
  fill = false,
}: {
  readonly value: ReadoutValue;
  readonly label: string;
  readonly view?: string | undefined;
  readonly analysis?:
    | ContractOutputs["dashboards"]["get"]["dashboard"]["tiles"][number]["analysis"]
    | undefined;
  readonly fill?: boolean;
}) => {
  switch (value.shape) {
    case "scalar":
      return (
        <>
          <p className="font-heading text-4xl leading-none tabular-nums">
            {measured(value.value)}
          </p>
          {value.trend === undefined ? null : <TrendNote trend={value.trend} />}
        </>
      );
    case "series":
      return (
        <>
          <SeriesChart
            fill={fill}
            label={label}
            view={view}
            series={
              value.series
                ? value.series.map((series) => ({
                    name: series.label,
                    points: series.points,
                  }))
                : [{ name: label, points: value.points }]
            }
          />
          {value.trend === undefined ? null : <TrendNote trend={value.trend} />}
        </>
      );
    case "breakdown":
      if (view === "bar")
        return (
          <BreakdownChart
            label={label}
            rows={value.rows}
            dimensions={value.dimensions}
            fill={fill}
          />
        );
      return <BreakdownTable value={value} analysis={analysis} fill={fill} />;
    case "funnel":
      return (
        <InsightTable
          fill={fill}
          columns={[
            { key: "step", label: "Step" },
            { key: "reached", label: "Reached", numeric: true },
            { key: "rate", label: "Of first", numeric: true },
          ]}
          rows={value.result.steps.map((step, index) => ({
            key: String(index),
            cells: [
              step.label,
              measured(step.reached),
              `${step.cumulativeRate.toFixed(1)}%`,
            ],
          }))}
        />
      );
  }
};
/**
 * A failure names the missing capability rather than saying "error", so the
 * page can say "retention is not available yet" instead of showing a spinner
 * that never stops.
 */
const Failed = ({
  failure,
}: {
  readonly failure: Extract<
    Readout,
    {
      ok: false;
    }
  >["failure"];
}) => {
  const sentence =
    failure.kind === "Timeout"
      ? `The query ran past its ${Math.round(failure.budgetMs / 1000)}s budget.`
      : failure.kind === "Unavailable"
        ? "The analytics engine is not answering."
        : failure.kind === "InvalidQuery"
          ? "This question is not answerable as written."
          : failure.feature === "retention"
            ? "Retention is not available yet."
            : `Not available yet: ${failure.feature.replace(/_/g, " ")}.`;
  return (
    <Alert variant="destructive">
      <AlertTitle>{sentence}</AlertTitle>
      <AlertDescription>
        {failure.kind}
        {failure.kind === "Unavailable" || failure.kind === "InvalidQuery"
          ? ` · ${failure.detail}`
          : ""}
      </AlertDescription>
    </Alert>
  );
};
export const ReadoutBody = ({
  readout,
  label,
  view,
  analysis,
  fill = false,
}: {
  readonly readout: Readout;
  readonly label: string;
  readonly view?: string | undefined;
  readonly analysis?:
    | ContractOutputs["dashboards"]["get"]["dashboard"]["tiles"][number]["analysis"]
    | undefined;
  readonly fill?: boolean;
}) => {
  if (!readout.ok) return <Failed failure={readout.failure} />;
  if (isEmpty(readout.value)) return <Empty>No events in this window.</Empty>;
  return (
    <div
      className={
        fill
          ? `flex h-full min-h-0 flex-col ${readout.value.shape === "scalar" ? "justify-end" : ""}`
          : undefined
      }
    >
      <Value
        value={readout.value}
        label={label}
        view={view}
        analysis={analysis}
        fill={fill}
      />
    </div>
  );
};
