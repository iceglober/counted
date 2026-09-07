"use client";
import { useId, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { Badge } from "@counted/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@counted/ui/components/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@counted/ui/components/chart";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@counted/ui/components/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@counted/ui/components/toggle-group";

const periods = [
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
];
const series = [186, 230, 198, 278, 246, 310, 352];
const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export default function DataWorkspaceExample() {
  const id = useId();
  const [period, setPeriod] = useState("week");
  const [metric, setMetric] = useState("readings");
  const config = {
    current: {
      label: metric === "records" ? "Records" : "Readings",
      color: "var(--chart-1)",
    },
  } satisfies ChartConfig;
  const readingTotal =
    series.reduce((sum, value) => sum + value, 0) *
    (period === "month" ? 4 : 1);
  const values = series.map((v, i) => ({
    day:
      period === "week"
        ? days[i]
        : ["Aug 7", "Aug 12", "Aug 17", "Aug 22", "Aug 27", "Sep 1", "Sep 5"][
            i
          ],
    current: Math.round(
      v * (period === "month" ? 4 : 1) * (metric === "records" ? 0.1 : 1),
    ),
  }));
  const total = values.reduce((sum, d) => sum + d.current, 0);
  return (
    <div className="@container/workspace flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <h3 className="text-lg font-semibold">A clearer picture.</h3>
          <p className="mt-2 text-xs text-muted-foreground">
            A small board of connected readings.
          </p>
        </div>
        <Select
          items={periods}
          value={period}
          onValueChange={(v) => v && setPeriod(v)}
        >
          <SelectTrigger className="min-w-36" aria-label="Reporting period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {periods.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-1 gap-4 @min-[480px]/workspace:grid-cols-3">
        {[
          ["Readings", readingTotal.toLocaleString("en-US"), "+12.8%"],
          ["Active records", period === "week" ? "24" : "38", "+4 this period"],
          ["Completion", "98.6%", "Steady"],
        ].map(([label, value, change]) => (
          <Card size="sm" key={label}>
            <CardHeader>
              <CardDescription>{label}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="font-heading text-2xl tabular-nums">{value}</p>
              <Badge variant="secondary" className="mt-3">
                {change}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            {metric === "records" ? "Record history" : "Reading history"}
          </CardTitle>
          <CardDescription>
            Example data for the selected interval.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ToggleGroup
            value={[metric]}
            onValueChange={(v) => v[0] && setMetric(v[0])}
            variant="outline"
            size="sm"
            aria-label="Chart metric"
            className="mb-6"
          >
            <ToggleGroupItem value="readings">Readings</ToggleGroupItem>
            <ToggleGroupItem value="records">Records</ToggleGroupItem>
          </ToggleGroup>
          <ChartContainer
            id={id}
            config={config}
            className="h-56 w-full"
            aria-label={`${metric}: ${total} for the selected period`}
          >
            <AreaChart
              accessibilityLayer
              data={values}
              margin={{ top: 10, right: 8, left: 8 }}
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
              <Area
                type="monotone"
                dataKey="current"
                fill="var(--color-current)"
                fillOpacity={0.1}
                stroke="var(--color-current)"
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
