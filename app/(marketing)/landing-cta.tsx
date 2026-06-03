"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { assignExperiment, track } from "./analytics";
import { AgentPrompt } from "./agent-prompt";

const VARIANTS = ["agent", "code", "command", "trylive"] as const;
type Variant = (typeof VARIANTS)[number];

const PROVISION = "curl -X POST https://app.counted.dev/api/v0/provision";

// A/B test the hero CTA section. Assignment is sticky in localStorage (not a
// tracking cookie) via the shared experiment primitive, which registers the
// variant as the exp_cta super-property — so the cta_click events below carry it
// automatically and the dogfood dashboard can compare conversion. Exposure is the
// explicit experiment_view event.
export function LandingCTA() {
  const [variant, setVariant] = useState<Variant | null>(null);

  useEffect(() => {
    const v = assignExperiment("cta", VARIANTS);
    setVariant(v);
    track("experiment_view", { experiment: "cta", variant: v });
  }, []);

  // Reserve space until assigned to avoid layout shift / SSR flash.
  if (!variant) return <div className="min-h-[20rem]" />;
  if (variant === "agent") return <AgentPrompt />;
  if (variant === "code") return <CodeVariant />;
  if (variant === "command") return <CommandVariant />;
  return <TryLiveVariant />;
}

function Eyebrow({ children }: { children: string }) {
  return <p className="text-xs font-medium tracking-[0.15em] uppercase text-accent">{children}</p>;
}

function CodeVariant() {
  return (
    <section className="px-6 max-w-2xl mx-auto pb-20 text-center">
      <Eyebrow>Start in 3 lines</Eyebrow>
      <h2 className="mt-2 font-display text-2xl md:text-3xl tracking-tight">Drop in the SDK</h2>
      <p className="mt-3 text-text-secondary max-w-md mx-auto leading-relaxed">
        Install, initialize, track. No cookies, no PII, under 3KB gzipped.
      </p>
      <pre className="mt-6 text-left bg-surface-1 border border-accent/30 rounded-xl px-5 py-5 text-xs md:text-sm font-mono text-text-secondary overflow-x-auto">
        <span className="text-accent">import</span>{" { Analytics } "}
        <span className="text-accent">from</span>{" \"@counted/sdk\";\n"}
        <span className="text-accent">const</span>{" counted = "}
        <span className="text-accent">new</span>{" Analytics({ projectKey: \"ck_...\" });\n"}
        {"counted.track(\"signup\", { plan: \"pro\" });"}
      </pre>
      <div className="mt-6">
        <Link
          href="/login"
          onClick={() => track("cta_click", { location: "homepage_hero", label: "start_free" })}
          className="inline-flex items-center justify-center px-6 py-3 bg-accent text-surface-0 rounded-md text-sm font-medium hover:bg-accent-hover active:translate-y-px transition-[background-color,transform] duration-150"
        >
          Start free
        </Link>
      </div>
    </section>
  );
}

function CommandVariant() {
  const [copied, setCopied] = useState(false);
  return (
    <section className="px-6 max-w-2xl mx-auto pb-20 text-center">
      <Eyebrow>One command</Eyebrow>
      <h2 className="mt-2 font-display text-2xl md:text-3xl tracking-tight">Spin up a key from your terminal</h2>
      <p className="mt-3 text-text-secondary max-w-md mx-auto leading-relaxed">
        Run it and you get a write-only key plus a claim link — no signup.
      </p>
      <div className="mt-6 flex items-stretch gap-2 bg-surface-1 border border-accent/30 rounded-xl px-4 py-3 text-left">
        <code className="flex-1 self-center text-xs md:text-sm font-mono text-text-secondary overflow-x-auto">{PROVISION}</code>
        <button
          onClick={() => {
            navigator.clipboard.writeText(PROVISION);
            track("cta_click", { location: "homepage_hero", label: "copy_command" });
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="shrink-0 px-3 py-1.5 text-xs font-medium bg-accent text-surface-0 rounded-md hover:bg-accent-hover transition-colors"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </section>
  );
}

function TryLiveVariant() {
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
      <Eyebrow>Try it now</Eyebrow>
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
