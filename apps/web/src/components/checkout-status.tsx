"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@counted/ui/components/alert";
import { Button } from "@counted/ui/components/button";

/** A return URL is not proof of payment. Wait for the webhook-backed entitlement. */
export function CheckoutStatus({ active }: { active: boolean }) {
  const router = useRouter();
  const [checks, setChecks] = useState(0);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (active || checks >= 12) return;
    const timer = setTimeout(() => {
      setChecks((value) => value + 1);
      startTransition(() => router.refresh());
    }, 5_000);
    return () => clearTimeout(timer);
  }, [active, checks, router]);
  return <Alert className="my-5"><AlertDescription className="flex flex-wrap items-center justify-between gap-3" aria-live="polite">
    <span>{active ? "Pro is active. Your updated allowances are ready." : checks < 12 ? "Checking your subscription. Pro will activate after payment is confirmed." : "Payment confirmation is still pending. You can check again or return later."}</span>
    {!active && checks >= 12 && <Button size="sm" variant="outline" disabled={pending} onClick={() => { setChecks(0); startTransition(() => router.refresh()); }}>Check again</Button>}
  </AlertDescription></Alert>;
}
