"use client";

import { useState } from "react";
import Link from "next/link";
import { track } from "./analytics";

// Below-the-fold CTA. Was a four-variant A/B test — collapsed to the live-provision
// flow (mint a key + claim link, no signup) once the experiment stopped being read:
// it's the one variant that demos the product instead of describing it.
export function LandingCTA() {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [result, setResult] = useState<{ clientKey: string; claimUrl: string } | null>(null);

  async function provision() {
    setState("loading");
    track("cta_click", { location: "homepage_hero", label: "provision" });
    try {
      const res = await fetch("/api/v0/provision", { method: "POST" });
      if (res.ok) {
        setResult(await res.json());
        setState("done");
      } else {
        setState("idle");
      }
    } catch {
      setState("idle");
    }
  }

  return (
    <section className="px-6 max-w-2xl mx-auto pb-20 text-center">
      <p className="text-xs font-medium tracking-[0.15em] uppercase text-accent">Try it now</p>
      <h2 className="mt-2 font-display text-2xl md:text-3xl tracking-tight">Get a live dashboard in seconds</h2>
      <p className="mt-3 text-text-secondary max-w-md mx-auto leading-relaxed">
        One click mints a project key and a claim link. No signup to start.
      </p>
      {state !== "done" ? (
        <button
          onClick={provision}
          disabled={state === "loading"}
          className="mt-6 inline-flex items-center justify-center px-6 py-3 bg-accent text-surface-0 rounded-md text-sm font-medium hover:bg-accent-hover active:translate-y-px transition-[background-color,transform] duration-150 disabled:opacity-50"
        >
          {state === "loading" ? "Creating…" : "Get my key →"}
        </button>
      ) : (
        result && (
          <div className="mt-6 bg-surface-1 border border-accent/30 rounded-xl p-5 text-left">
            <p className="text-xs text-text-tertiary mb-1">Your client key</p>
            <code className="block text-sm font-mono text-text-primary break-all">{result.clientKey}</code>
            <Link
              href={result.claimUrl}
              className="mt-4 inline-flex items-center justify-center px-4 py-2 bg-accent text-surface-0 rounded-md text-sm font-medium hover:bg-accent-hover transition-colors"
            >
              Open your live dashboard →
            </Link>
          </div>
        )
      )}
    </section>
  );
}
