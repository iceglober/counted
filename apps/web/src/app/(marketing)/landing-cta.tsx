"use client";

import { browserApi } from "@/lib/api";

import { useState } from "react";
import Link from "next/link";
import { track } from "./analytics";

// "Try it now" — mints a project key and a claim link, no signup.
export function LandingCTA() {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [result, setResult] = useState<{ clientKey: string; claimUrl: string } | null>(null);

  async function provision() {
    setState("loading");
    track("cta_click", { location: "homepage_hero", label: "provision" });
    try {
      // Through the same client as everything else. This called
      // `/api/v0/provision` on its own origin — a v1 route that does not
      // exist in v2, so the landing page's primary call to action would have
      // failed silently the moment traffic moved.
      const { data } = await browserApi()<{ ingestKey: string; claimUrl: string }>("provisionProject", { body: {} });
      setResult({ clientKey: data.ingestKey, claimUrl: data.claimUrl });
      setState("done");
    } catch {
      setState("idle");
    }
  }

  return (
    <div>
      <h2>Try it now</h2>
      <p>
        One click gets you a project key and a live dashboard. No signup.
      </p>
      {state !== "done" ? (
        <p>
          <button className="btn" onClick={provision} disabled={state === "loading"}>
            {state === "loading" ? "Creating…" : "Get my key"}
          </button>
        </p>
      ) : (
        result && (
          <div className="note">
            Your client key: <code>{result.clientKey}</code>
            <br />
            <Link href={result.claimUrl}>Open your live dashboard &raquo;</Link>
          </div>
        )
      )}
    </div>
  );
}
