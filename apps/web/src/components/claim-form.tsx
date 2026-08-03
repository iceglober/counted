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

  const claim = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Empty means "keep the suggestion" — the field shows it as placeholder, so
    // submitting untouched is a deliberate choice rather than a blank name.
    const chosen = String(new FormData(event.currentTarget).get("name") ?? "").trim() || projectName;

    setState("claiming");
    try {
      const { data } = await browserApi()<{ workspace: { id: string } }>("redeemClaim", {
        params: { token },
        // Names the workspace too, so a first project does not land inside
        // something called "Untitled".
        body: { workspaceName: chosen, projectName: chosen },
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
      {/*
        The generated name is the placeholder, not the value.

        As a value it would look like something already decided, and the first
        thing a new account does would be clearing a field to say what it
        actually wanted. As a placeholder it reads as an offer: type a name, or
        submit and take this one.
      */}
      <form onSubmit={claim} className="field">
        <label htmlFor="claim-name">Choose a name, or use the suggested one</label>
        <input
          id="claim-name"
          name="name"
          placeholder={projectName}
          maxLength={100}
          autoComplete="off"
        />
        <button type="submit" disabled={state === "claiming"}>
          {state === "claiming" ? "Claiming…" : "Claim"}
        </button>
      </form>
      {state === "failed" && detail !== null && (
        <p className="tile-error" role="alert">
          {detail}
        </p>
      )}
    </>
  );
};
