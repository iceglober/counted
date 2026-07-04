"use client";

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
    <div>
      <h2>Try it now</h2>
      <p>
        One click mints a project key and a live dashboard — no signup to start.
      </p>
      {state !== "done" ? (
        <p>
          <button onClick={provision} disabled={state === "loading"}>
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
