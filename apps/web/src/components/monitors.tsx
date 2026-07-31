/**
 * A project's monitors.
 *
 * At project scope, which is the point of #67: v1 put these in Settings behind
 * their own project selector, so the alert you created could belong to a
 * project other than the one on screen — and nothing on the alert said which.
 *
 * The state column reports what the *server* decided. A monitor is breaching
 * or it is not; recomputing that here from `lastValue` and a threshold would
 * be a second opinion, free to disagree with the one that actually sends the
 * notifications.
 */

import type { ReactElement } from "react";

export type Monitor = {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly state: string;
  readonly lastValue?: number | null;
};

const STATE_LABEL: Readonly<Record<string, string>> = {
  ok: "within threshold",
  breaching: "breaching",
};

export const MonitorTable = ({ monitors }: { monitors: readonly Monitor[] | null }): ReactElement => {
  if (monitors === null) {
    return (
      <p className="tile-error" role="alert">
        The monitors for this project could not be listed.
      </p>
    );
  }

  if (monitors.length === 0) {
    return (
      <p className="tile-empty">
        No monitors on this project. A monitor watches one measurement and tells you when it crosses a threshold.
      </p>
    );
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Monitor</th>
          <th>State</th>
          <th className="numeric">Last value</th>
        </tr>
      </thead>
      <tbody>
        {monitors.map((monitor) => (
          <tr key={monitor.id}>
            <td>
              {monitor.name}
              {/* Disabled is not a state of the measurement — it is a state of
                  the monitor — so it is said separately rather than replacing
                  "breaching" with "off" and losing the reading. */}
              {!monitor.enabled && <span className="tile-empty"> · disabled</span>}
            </td>
            <td style={monitor.state === "breaching" ? { color: "var(--error)" } : undefined}>
              {STATE_LABEL[monitor.state] ?? monitor.state}
            </td>
            <td className="numeric">
              {/* An unevaluated monitor has no reading. A dash says so; `0`
                  would claim it measured nothing, which is a different fact. */}
              {monitor.lastValue === null || monitor.lastValue === undefined
                ? "—"
                : monitor.lastValue.toLocaleString("en-US")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
