"use client";

import { useState } from "react";
import Link from "next/link";
import { TallyMark } from "@/components/icons";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (email) setSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex items-center gap-2.5 mb-10">
          <TallyMark className="w-6 h-6 text-accent" />
          <span className="font-display text-2xl tracking-wide">Counted</span>
        </div>

        {sent ? (
          <div className="animate-rise">
            <h1 className="text-xl font-semibold">Check your email</h1>
            <p className="text-sm text-text-secondary mt-2 leading-relaxed">
              We sent a sign-in link to{" "}
              <span className="text-text-primary font-medium">{email}</span>.
              Click the link to continue.
            </p>
            <button
              onClick={() => setSent(false)}
              className="mt-6 text-sm text-accent hover:text-accent-hover transition-colors"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="animate-rise">
            <h1 className="text-xl font-semibold">Sign in to Counted</h1>
            <p className="text-sm text-text-secondary mt-2">
              No password needed. We will send you a magic link.
            </p>

            <label className="block mt-6">
              <span className="text-xs text-text-secondary uppercase tracking-wider">
                Email
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="mt-1.5 w-full px-3 py-2.5 bg-surface-1 border border-border rounded-md text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 transition-colors"
              />
            </label>

            <button
              type="submit"
              className="mt-4 w-full px-4 py-2.5 bg-accent text-surface-0 rounded-md text-sm font-medium hover:bg-accent-hover transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40 focus:ring-offset-2 focus:ring-offset-surface-0"
            >
              Send magic link
            </button>
          </form>
        )}

        <div className="mt-12 pt-6 border-t border-border">
          <Link
            href="/"
            className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
          >
            &larr; Back to counted.dev
          </Link>
        </div>
      </div>
    </div>
  );
}
