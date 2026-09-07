import { Badge } from "@counted/ui/components/badge";
/**
 * Two pills, one vocabulary.
 *
 * Both pair a colour with a word (R13). Both use the functional
 * `--ok`/`--warn`/`--bad` tokens, which are a different hue family from the
 * all-blue series ramp, so a status can never read as a data series.
 */

import type { ContractOutputs } from "../lib/client";

type QuotaState =
  ContractOutputs["workspaces"]["usage"]["usage"]["events"]["state"];

/**
 * `overage` is amber, not red, because the domain is explicit that this band
 * still accepts events. Collapsing it into `rejected` would tell the same lie
 * the three-state contract exists to prevent: two states that mean different
 * things rendering identically, so a customer discovers a hard stop from a
 * missing chart.
 */
const QUOTA: Readonly<
  Record<
    QuotaState,
    {
      readonly tone: "success" | "warning" | "destructive";
      readonly label: string;
    }
  >
> = {
  ok: { tone: "success", label: "OK" },
  overage: { tone: "warning", label: "Over allowance" },
  rejected: { tone: "destructive", label: "Limit reached" },
};

export const QuotaPill = ({ state }: { readonly state: QuotaState }) => {
  const { tone, label } = QUOTA[state];
  return <Badge variant={tone}>{label}</Badge>;
};

type CredentialStatus =
  ContractOutputs["credentials"]["list"]["items"][number]["status"];

/**
 * The four states, all four visible.
 *
 * `expiring` is the one that matters and the one a three-state rendering
 * loses: a key inside a rotation's grace window is still working and still
 * needs replacing. Showing it as "active" hides the deadline; showing it as
 * "expired" says the integration is already broken when it is not.
 */
const CREDENTIAL: Readonly<
  Record<
    CredentialStatus,
    {
      readonly tone: "success" | "warning" | "destructive";
      readonly label: string;
    }
  >
> = {
  active: { tone: "success", label: "Active" },
  expiring: { tone: "warning", label: "Expiring" },
  revoked: { tone: "destructive", label: "Revoked" },
  expired: { tone: "destructive", label: "Expired" },
};

export const CredentialStatusPill = ({
  status,
}: {
  readonly status: CredentialStatus;
}) => {
  const { tone, label } = CREDENTIAL[status];
  return <Badge variant={tone}>{label}</Badge>;
};

type MonitorState =
  ContractOutputs["monitors"]["list"]["items"][number]["state"];

/**
 * Two states on the wire, three on the page.
 *
 * A disabled monitor still carries a `state`, and the domain resets it to `ok`
 * on disable so that re-enabling does not re-announce stale news. Rendering
 * that `ok` as "OK" would say the number is fine when nothing is looking at
 * it, so disabled is shown first and without a status colour: it is not a
 * verdict about the number.
 */
const MONITOR: Readonly<
  Record<
    MonitorState,
    {
      readonly tone: "success" | "warning" | "destructive";
      readonly label: string;
    }
  >
> = {
  ok: { tone: "success", label: "OK" },
  breaching: { tone: "destructive", label: "Breaching" },
};

export const MonitorStatePill = ({
  enabled,
  state,
  lastMeasuredAt,
  evaluationError,
  failedDeliveries = 0,
}: {
  readonly enabled: boolean;
  readonly state: MonitorState;
  readonly lastMeasuredAt: string | null;
  readonly evaluationError: string | null;
  readonly failedDeliveries?: number;
}) => {
  if (!enabled) return <Badge variant="outline">Disabled</Badge>;
  if (evaluationError) return <Badge variant="destructive">{evaluationError === "No data in the observation window." ? "No data" : "Check failed"}</Badge>;
  if (lastMeasuredAt === null) return <Badge variant="outline">Awaiting first check</Badge>;
  if (Date.now() - Date.parse(lastMeasuredAt) > 15 * 60 * 1000) return <Badge variant="outline">Stale</Badge>;
  if (failedDeliveries > 0) return <Badge variant="destructive">Delivery delayed</Badge>;
  const { tone, label } = MONITOR[state];
  return <Badge variant={tone}>{label}</Badge>;
};
