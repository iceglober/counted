"use client";

import { useState } from "react";
import type { ContractOutputs } from "../lib/client";
import { startCheckout } from "../actions/billing";
import { SelectControl } from "./select-control";
import { Field } from "./form";
import { SubmitButton } from "./submit";
import { money } from "../lib/money";

export function PlanUpgrade({ workspaceId, prices }: { workspaceId: string; prices: ContractOutputs["billing"]["plans"]["prices"] }) {
  const [cadence, setCadence] = useState("monthly");
  const price = prices.find((one) => one.plan === "pro" && one.cadence === cadence);
  return <form action={startCheckout} className="space-y-4">
    <input type="hidden" name="workspaceId" value={workspaceId} />
    <input type="hidden" name="returnTo" value={`/w/${workspaceId}/settings?tab=plan`} />
    <div className="max-w-xs"><Field label="Pro billing frequency" htmlFor="cadence">
      <SelectControl id="cadence" name="cadence" value={cadence} onValueChange={setCadence} items={[{ value: "monthly", label: "Monthly" }, { value: "annual", label: "Annually" }]} />
    </Field></div>
    {price && <p><strong className="text-2xl tabular-nums">{money(price.amount, price.currency)}</strong><span className="text-muted-foreground"> / {cadence === "annual" ? "year" : "month"}</span></p>}
    <SubmitButton disabled={!price} pendingLabel="Opening checkout…">Upgrade to Pro</SubmitButton>
    <p className="text-xs text-muted-foreground">Review the total in Stripe before paying. This selection applies to your new subscription.</p>
  </form>;
}
