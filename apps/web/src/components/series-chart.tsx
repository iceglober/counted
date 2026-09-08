"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@counted/ui/components/chart";
import { visibleSeries, type Series, RAMP, OVERFLOW } from "../lib/chart";
import { measured } from "../lib/format";

export function SeriesChart({
  series,
  label,
  view = "line",
  fill = false,
}: {
  series: readonly Series[];
  label: string;
  view?: string | undefined;
  fill?: boolean;
}) {
  const drawn = visibleSeries(series);
  const buckets = [
    ...new Set(
      drawn.flatMap((item) => item.points.map((point) => point.bucketStart)),
    ),
  ].sort();
  const maps = drawn.map(
    (item) =>
      new Map(item.points.map((point) => [point.bucketStart, point.value])),
  );
  const data = buckets.map((bucket) =>
    Object.fromEntries([
      ["bucket", bucket],
      ...maps.map((values, i) => [`series${i}`, values.get(bucket) ?? null]),
    ]),
  );
  const config: ChartConfig = Object.fromEntries(
    drawn.map((item, i) => [
      `series${i}`,
      { label: item.name, color: (RAMP[i] ?? OVERFLOW).stroke },
    ]),
  );
  const intraday =
    buckets.length > 1 &&
    Date.parse(buckets.at(-1)!) - Date.parse(buckets[0]!) <= 48 * 3_600_000 &&
    Date.parse(buckets[1]!) - Date.parse(buckets[0]!) < 24 * 3_600_000;
  const Plot = view === "bar" ? BarChart : AreaChart;
  const Mark = view === "bar" ? Bar : Area;
  const summary = drawn
    .map(
      (item) =>
        `${item.name}: peak ${measured(Math.max(0, ...item.points.map((point) => point.value)))}`,
    )
    .join("; ");
  return (
    <figure className={fill ? "flex min-h-0 min-w-0 flex-1 flex-col" : "min-w-0"}>
      <ChartContainer
        config={config}
        initialDimension={{ width: 200, height: 192 }}
        className={fill ? "h-full min-h-0 w-full flex-1 aspect-auto" : drawn.length > 1 ? "h-56 w-full" : "h-48 w-full"}
        role="group"
        aria-label={`${label}. ${buckets.length} buckets. ${summary}`}
      >
        <Plot
          accessibilityLayer
          data={data}
          margin={{ top: 12, right: 8, left: 8 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="bucket"
            axisLine={false}
            tickLine={false}
            tickMargin={10}
            minTickGap={32}
            interval="preserveStartEnd"
            tickFormatter={(value) =>
              new Date(value).toLocaleString("en-US", {
                ...(intraday
                  ? { hour: "numeric" }
                  : { month: "short", day: "numeric" }),
                timeZone: "UTC",
              })
            }
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) =>
                  new Date(String(value)).toLocaleString("en-US", {
                    timeZone: "UTC",
                  })
                }
              />
            }
          />
          {drawn.map((item, i) => (
            <Mark
              key={i}
              type="linear"
              dataKey={`series${i}`}
              fill={`var(--color-series${i})`}
              fillOpacity={view === "bar" ? 0.8 : 0.1}
              stroke={`var(--color-series${i})`}
              strokeWidth={2}
              strokeDasharray={
                view === "bar" ? "none" : ((RAMP[i] ?? OVERFLOW).dash ?? "none")
              }
              isAnimationActive={false}
              {...(view === "bar"
                ? {}
                : { dot: buckets.length === 1 ? { r: 3 } : false })}
            />
          ))}
          {drawn.length > 1 && (
            <ChartLegend
              verticalAlign="top"
              content={
                <ChartLegendContent
                  verticalAlign="top"
                  className="flex-wrap gap-x-4 gap-y-2 pb-5 [&>div]:min-w-0 [&>div]:max-w-full [&>div]:[overflow-wrap:anywhere]"
                />
              }
            />
          )}
        </Plot>
      </ChartContainer>
      <figcaption className={fill ? "sr-only" : "mt-3 text-xs text-muted-foreground"}>
        {summary}
      </figcaption>
    </figure>
  );
}
