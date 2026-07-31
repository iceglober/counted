"use client";

import { useState } from "react";
import { browserApi } from "@/lib/api";

/**
 * Adopt, or sign in first.
 *
 * The redeem call requires a session. When there is none the API answers 401,
 * and the honest thing to do is say so and offer the sign-in link — rather
 * than redirecting silently and losing the token the person arrived with.
 */
export const ClaimForm = ({ token, projectName }: { token: string; projectName: string }) => {
  const [state, setState] = useState<"idle" | "claiming" | "signin" | "failed">("idle");
  const [detail, setDetail] = useState<string | null>(null);

  const claim = async () => {
    setState("claiming");
    try {
      const { data } = await browserApi()<{ workspace: { id: string } }>("redeemClaim", {
        params: { token },
        // Names the workspace when one is being opened, so a first project
        // does not land in something called "Untitled".
        body: { workspaceName: projectName },
      });
      window.location.href = `/projects?workspace=${data.workspace.id}`;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401) {
        setState("signin");
        return;
      }
      setDetail(error instanceof Error ? error.message : "The project could not be claimed.");
      setState("failed");
    }
  };

  if (state === "signin") {
    return (
      <p>
        {/* The token stays in the URL, so signing in returns here rather than
            dropping the thing they came to claim. */}
        <a href={`/sign-in?next=${encodeURIComponent(`/claim/${token}`)}`}>Sign in to claim this project</a>
      </p>
    );
  }

  return (
    <>
      <button type="button" onClick={claim} disabled={state === "claiming"}>
        {state === "claiming" ? "Claiming…" : "Claim it"}
      </button>
      {state === "failed" && detail !== null && (
        <p className="tile-error" role="alert">
          {detail}
        </p>
      )}
    </>
  );
};
