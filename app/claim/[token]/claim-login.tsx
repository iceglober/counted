"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

// Sign-up form for the claim page. After the magic link is verified the user
// lands back on /claim/<token>, which then completes the claim.
export function ClaimLogin({ token }: { token: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await authClient.signIn.magicLink({ email, callbackURL: `/claim/${token}` });
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <p className="text-sm text-text-secondary">
        Check your email for a magic link. Open it and your dashboard is yours.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent/60"
      />
      <button
        type="submit"
        disabled={loading}
        className="px-3 py-2 text-sm font-medium text-surface-0 bg-accent rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50"
      >
        {loading ? "Sending…" : "Claim my dashboard"}
      </button>
    </form>
  );
}
