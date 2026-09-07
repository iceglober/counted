import type { ContractOutputs } from "../lib/client";
import { measured } from "../lib/format";
import { InsightTable } from "./insight-table";

type Readout = ContractOutputs["dashboards"]["readouts"]["readouts"][number];
type Value = Extract<
  Extract<Readout, { ok: true }>["value"],
  { shape: "breakdown" }
>;
type Analysis =
  ContractOutputs["dashboards"]["get"]["dashboard"]["tiles"][number]["analysis"];

export function BreakdownTable({
  value,
  analysis,
  fill = false,
}: {
  value: Value;
  analysis?: Analysis | undefined;
  fill?: boolean;
}) {
  const fields =
    analysis?.shape === "breakdown"
      ? Array.isArray(analysis.by)
        ? analysis.by
        : [analysis.by]
      : [];
  const dimensions =
    value.dimensions ??
    fields.map((field) => ({ key: field.key, label: field.key }));
  return (
    <InsightTable
      fill={fill}
      columns={[
        ...(dimensions.length
          ? dimensions
          : [{ key: "breakdown", label: "Breakdown" }]),
        { key: "value", label: "Value", numeric: true },
      ]}
      rows={value.rows.map((row) => ({
        key: JSON.stringify(row.keys ?? row.label),
        cells: [
          ...(row.keys && dimensions.length
            ? row.keys.map((key) => key ?? "(not set)")
            : [row.label]),
          measured(row.value),
        ],
      }))}
    />
  );
}
