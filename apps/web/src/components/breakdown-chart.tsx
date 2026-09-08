"use client";

import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@counted/ui/components/chart";
import type { ContractOutputs } from "../lib/client";
import { measured } from "../lib/format";

type Readout = ContractOutputs["dashboards"]["readouts"]["readouts"][number];
type Value = Extract<Readout, { ok: true }>["value"];
type Rows = Extract<Value, { shape: "breakdown" }>["rows"];

/** Rank categories across the whole period; no invented dates or summed uniques. */
export function BreakdownChart({ rows, label, dimensions, fill = false }: { rows: Rows; label: string; dimensions?: Extract<Value, {shape: "breakdown"}>["dimensions"]; fill?: boolean }) {
  const propertyLabel = dimensions?.map((field) => field.label).join(" · ") ?? label;
  const height = Math.max(120, rows.length * 36 + 16);
  const hasNegative = rows.some((row) => row.value < 0);
  return (
    <figure className={fill ? "flex min-h-0 min-w-0 flex-1 flex-col" : "min-w-0"}>
      <figcaption className="mb-2 shrink-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">{propertyLabel}</figcaption>
      <ChartContainer
        config={{ value: { label: "Value", color: "var(--primary)" } }}
        initialDimension={{ width: 240, height }}
        className={fill ? "h-full min-h-0 w-full flex-1 aspect-auto" : "w-full aspect-auto"}
        style={fill ? undefined : { height }}
        role="group"
        aria-label={`${label}. By ${propertyLabel}. ${rows.length} categories.`}
      >
        <BarChart
          accessibilityLayer
          data={rows}
          layout="vertical"
          margin={{ top: 8, right: 48, bottom: 8, left: 0 }}
        >
          <XAxis
            type="number"
            hide
            domain={hasNegative ? ["auto", "auto"] : [0, "auto"]}
          />
          <YAxis
            type="category"
            dataKey="label"
            axisLine={false}
            tickLine={false}
            width={88}
            tickMargin={8}
            interval={0}
            tickFormatter={(value: string) =>
              value.length > 13 ? `${value.slice(0, 12)}…` : value
            }
          />
          <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(value) => `${propertyLabel}: ${String(value)}`} />} />
          <Bar
            dataKey="value"
            fill="var(--color-value)"
            maxBarSize={18}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="value"
              position="right"
              offset={8}
              className="fill-foreground text-xs tabular-nums"
              formatter={(value) =>
                new Intl.NumberFormat("en-US", {
                  notation: "compact",
                  maximumFractionDigits: 1,
                }).format(Number(value))
              }
            />
          </Bar>
        </BarChart>
      </ChartContainer>
      <dl className="sr-only" aria-label={label}>
        {rows.map((row) => (
          <div key={row.keys ? JSON.stringify(row.keys) : row.label}>
            <dt>{row.label}</dt>
            <dd>{measured(row.value)}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}
