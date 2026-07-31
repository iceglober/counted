"use client";

import { useState } from "react";
import { browserApi } from "@/lib/api";

/**
 * The first screen: a key, something to paste, and a button that proves it.
 *
 * The button is the point. v1's onboarding told you to install an SDK and then
 * offered no way to find out whether it had worked — so the first signal that
 * anything was wrong arrived days later, as an empty dashboard. This sends a
 * real event to the real endpoint with the real key and reports what came
 * back, which is the same thing the customer's own code will do.
 *
 * It also cannot be faked. There is no local "success" state to set: the state
 * shown is derived from the API's own receipt, so a broken ingest path shows
 * as broken here before anybody has written a line.
 */

export type Provisioned = {
  readonly project: { readonly id: string; readonly name: string };
  readonly ingestKey: string;
  readonly claimUrl: string;
  readonly snippet: string;
};

type SendState =
  | { readonly kind: "idle" }
  | { readonly kind: "sending" }
  /** The server's own receipt, not a local flag. */
  | { readonly kind: "accepted"; readonly accepted: number }
  | { readonly kind: "refused"; readonly detail: string };

export const Onboarding = ({ provisioned }: { provisioned: Provisioned }) => {
  const [send, setSend] = useState<SendState>({ kind: "idle" });

  const sendTestEvent = async () => {
    setSend({ kind: "sending" });
    try {
      // Through the same client as everything else, carrying the project key
      // instead of the session — the ingest endpoint authenticates with a
      // credential, not a cookie. Same endpoint, same header, same body shape
      // a customer's SDK sends, because the contract defines all three.
      const { data } = await browserApi()<{ accepted: number }>("ingestEvents", {
        bearer: provisioned.ingestKey,
        body: {
          events: [
            {
              name: "test_event",
              visitId: `onboarding-${provisioned.project.id}`,
              occurredAt: new Date().toISOString(),
              properties: { source: "onboarding" },
            },
          ],
        },
      });

      // The receipt names what was accepted. A 202 with nothing accepted is
      // not a success, and v1 could not tell those apart at all.
      setSend({ kind: "accepted", accepted: data.accepted ?? 0 });
    } catch (error) {
      setSend({ kind: "refused", detail: error instanceof Error ? error.message : "The request did not complete." });
    }
  };

  return (
    <section>
      <h2>1. Your key</h2>
      <p className="tile-empty">
        Public, and meant to ship in your bundle. It is shown once — this page is the only place it appears.
      </p>
      <pre style={{ fontFamily: "var(--font-mono)", background: "var(--surface-1)", padding: "0.5rem" }}>
        {provisioned.ingestKey}
      </pre>

      <h2>2. Install</h2>
      {/* Built by the API, so an agent calling /v1/provision gets the same
          snippet. Two copies is two things to go stale. */}
      <pre style={{ fontFamily: "var(--font-mono)", background: "var(--surface-1)", padding: "0.5rem", overflowX: "auto" }}>
        {provisioned.snippet}
      </pre>

      <h2>3. Check it works</h2>
      <button type="button" onClick={sendTestEvent} disabled={send.kind === "sending"}>
        {send.kind === "sending" ? "Sending…" : "Send a test event"}
      </button>

      {send.kind === "accepted" && send.accepted > 0 && (
        <p style={{ color: "var(--success)" }} role="status">
          Accepted. {send.accepted} event stored — your key and endpoint both work.
        </p>
      )}
      {send.kind === "accepted" && send.accepted === 0 && (
        // A 202 that stored nothing. Reporting it as success is what made a
        // quota rejection look like a working integration in v1.
        <p className="tile-error" role="alert">
          The request succeeded but nothing was stored. Check the project&apos;s quota.
        </p>
      )}
      {send.kind === "refused" && (
        <p className="tile-error" role="alert">
          {send.detail}
        </p>
      )}

      <h2>4. Keep it</h2>
      <p className="tile-empty">
        This project is unclaimed — it works now, and stops accepting events when its claim link expires. Sign in to
        keep it.
      </p>
      <p>
        <a href={provisioned.claimUrl}>Claim this project</a>
      </p>
    </section>
  );
};
