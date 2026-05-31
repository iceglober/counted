import type { MetricData, TimeSeriesData, BreakdownItem, Insight } from "./types";
export type { MetricData, TimeSeriesData, BreakdownItem, Insight };

export const projects = [
  { id: "proj_1", name: "Counted Web", apiKey: "A-US-7F3D2E1A9C" },
  { id: "proj_2", name: "Mobile App", apiKey: "A-US-4B8E6C2F1D" },
  { id: "proj_3", name: "Marketing Site", apiKey: "A-US-9A1D5F8B3E" },
];

function series(base: number, variance: number, len = 30): number[] {
  return Array.from({ length: len }, (_, i) => {
    const weekday = (i + 3) % 7 < 5 ? 1.15 : 0.75;
    const trend = 1 + (i / len) * 0.12;
    const wave = Math.sin(i * 0.8) * 0.15 + Math.cos(i * 1.4) * 0.1;
    return Math.round(base * weekday * trend * (1 + wave));
  });
}

function dates(len = 30): string[] {
  return Array.from({ length: len }, (_, i) => `May ${i + 1}`);
}

const labels = dates();
const sessionSeries = series(420, 80);
const eventSeries = series(1600, 200);

export const demoInsights: Insight[] = [
  { id: "d1", type: "metric", title: "Sessions", span: 1, data: { value: "12,847", trend: 12.3, sparkline: sessionSeries.slice(-14) } },
  { id: "d2", type: "metric", title: "Events", span: 1, data: { value: "48,291", trend: 8.1, sparkline: eventSeries.slice(-14) } },
  { id: "d3", type: "metric", title: "Avg Events / Session", span: 1, data: { value: "3.8", trend: 3.8, sparkline: series(3.8, 0.5, 14) } },
  { id: "d4", type: "metric", title: "New Users", span: 1, data: { value: "2,941", trend: 15.2, sparkline: series(98, 15, 14) } },
  { id: "d5", type: "timeseries", title: "Sessions over time", span: 4, data: { labels, values: sessionSeries } },
  { id: "d6", type: "breakdown", title: "Top Events", span: 2, data: { items: [
    { label: "page_view", value: 23481 }, { label: "button_click", value: 8923 },
    { label: "form_submit", value: 3247 }, { label: "sign_up", value: 1842 },
    { label: "purchase", value: 956 }, { label: "share", value: 412 },
  ] } },
  { id: "d7", type: "timeseries", title: "Events over time", span: 2, data: { labels, values: eventSeries } },
  { id: "d8", type: "breakdown", title: "Operating Systems", span: 2, data: { items: [
    { label: "macOS", value: 5234 }, { label: "Windows", value: 4012 },
    { label: "Linux", value: 1752 }, { label: "iOS", value: 1002 }, { label: "Android", value: 501 },
  ] } },
  { id: "d9", type: "breakdown", title: "App Versions", span: 2, data: { items: [
    { label: "2.4.0", value: 4821 }, { label: "2.3.2", value: 3902 },
    { label: "2.3.1", value: 2141 }, { label: "2.2.0", value: 1087 }, { label: "2.1.x", value: 550 },
  ] } },
];
