import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BreakdownTable } from "./breakdown-table";
import { ReadoutBody } from "./readout";

test("one and several breakdown properties supply the actual column names", () => {
  for (const dimensions of [
    [{ key: "url", label: "url" }],
    [
      { key: "os_name", label: "os_name" },
      { key: "locale", label: "locale" },
    ],
  ]) {
    const html = renderToStaticMarkup(
      <BreakdownTable
        value={{
          shape: "breakdown",
          dimensions,
          rows: [
            {
              label: "sample",
              keys: dimensions.map(() => "sample"),
              value: 12,
            },
          ],
        }}
      />,
    );
    for (const { key } of dimensions) expect(html).toContain(`>${key}</th>`);
    expect(html).not.toContain("Property value");
  }
});

test("funnel rates already expressed as percentages are not multiplied again", () => {
  const html = renderToStaticMarkup(
    <ReadoutBody
      label="Conversion"
      readout={{
        tile: "funnel",
        id: "readout",
        computedAt: "2026-09-07T00:00:00.000Z",
        ok: true,
        value: {
          shape: "funnel",
          result: {
            overallRate: 40,
            steps: [
              {
                label: "Start",
                reached: 100,
                rate: 100,
                cumulativeRate: 100,
                droppedOff: 0,
              },
              {
                label: "Complete",
                reached: 40,
                rate: 40,
                cumulativeRate: 40,
                droppedOff: 60,
              },
            ],
          },
        },
      }}
    />,
  );
  expect(html).toContain("100.0%");
  expect(html).toContain("40.0%");
  expect(html).not.toContain("10000");
});
