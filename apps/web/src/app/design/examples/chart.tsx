"use client";
import {
  Area,
  AreaChart,
  Line,
  LineChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@counted/ui/components/chart";
export const readingData = [
  { day: "Mon", current: 186, previous: 140 },
  { day: "Tue", current: 230, previous: 180 },
  { day: "Wed", current: 198, previous: 170 },
  { day: "Thu", current: 278, previous: 205 },
  { day: "Fri", current: 246, previous: 194 },
  { day: "Sat", current: 310, previous: 226 },
  { day: "Sun", current: 352, previous: 250 },
];
const config = {
  current: { label: "Current period", color: "var(--chart-1)" },
  previous: { label: "Previous period", color: "var(--chart-4)" },
} satisfies ChartConfig;
export default function ChartExample({
  variant = "area",
}: {
  variant?: string;
}) {
  const Plot =
    variant === "line" ? LineChart : variant === "bar" ? BarChart : AreaChart;
  const Series = variant === "line" ? Line : variant === "bar" ? Bar : Area;
  return (
    <div className="w-full">
      <ChartContainer
        config={config}
        className="h-56 w-full"
        role="group"
        aria-label="Readings rise from 186 on Monday to 352 on Sunday. The previous period rises from 140 to 250."
      >
        <Plot
          accessibilityLayer
          data={readingData}
          margin={{ left: 8, right: 8, top: 10 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            interval="preserveStartEnd"
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tickMargin={12}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Series
            type="monotone"
            dataKey="previous"
            fill="var(--color-previous)"
            fillOpacity={0.3}
            stroke="var(--color-previous)"
            isAnimationActive={false}
          />
          <Series
            type="monotone"
            dataKey="current"
            fill="var(--color-current)"
            fillOpacity={0.12}
            stroke="var(--color-current)"
            strokeWidth={2}
            isAnimationActive={false}
          />
        </Plot>
      </ChartContainer>
      <p className="mt-5 text-xs text-muted-foreground">
        Current and previous period · example readings
      </p>
    </div>
  );
}
