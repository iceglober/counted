"use client";

import { useState } from "react";
import { browserApi } from "@/lib/api";

/**
 * Sign in.
 *
 * The form always reports the same thing, because the API always answers the
 * same thing: whether an address has an account is not something a signed-out
 * caller may learn. There is no "no account with that email", and no separate
 * sign-up — requesting a link for an unknown address creates one.
 */
export default function SignIn() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "invalid">("idle");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get("email");
    setState("sending");
    try {
      await browserApi()("requestSignInLink", { body: { email: String(email ?? "") } });
      setState("sent");
    } catch {
      // The only refusal this endpoint makes is "that is not an address",
      // which is a fact about the input rather than about who has an account.
      setState("invalid");
    }
  };

  if (state === "sent") {
    return (
      <main>
        <h1>Check your mail</h1>
        <p>If that address can receive mail, a sign-in link is on its way. It works once, and expires in 15 minutes.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Sign in to Counted</h1>
      <form onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
        <button type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Email me a link"}
        </button>
      </form>
      {state === "invalid" && <p role="alert">That does not look like an email address.</p>}
    </main>
  );
}
