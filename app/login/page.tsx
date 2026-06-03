"use client";

import { useState } from "react";
import Link from "next/link";
import { CountedLogo } from "@/components/icons";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [sentEmail, setSentEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    setError("");

    try {
      const result = await authClient.signIn.magicLink({
        email,
        callbackURL: "/dashboards",
      });

      if (result.error) {
        setError(result.error.message ?? "Failed to send magic link");
      } else {
        setSentEmail(email);
        setSent(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex items-center gap-2.5 mb-10">
          <CountedLogo className="w-6 h-6 text-accent" />
          <span className="font-display text-2xl tracking-wide">Counted</span>
        </div>

        {sent ? (
          <div className="animate-rise">
            <h1 className="text-xl font-semibold">Check your email</h1>
            <p className="text-sm text-text-secondary mt-2 leading-relaxed">
              We sent a sign-in link to{" "}
              <span className="text-text-primary font-medium">{sentEmail}</span>.
              Click the link to continue.
            </p>
            <Button
              variant="link"
              onClick={() => setSent(false)}
              className="mt-6 h-auto p-0 text-sm"
            >
              Use a different email
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="animate-rise">
            <h1 className="text-xl font-semibold">Sign in to Counted</h1>
            <p className="text-sm text-text-secondary mt-2">
              No password needed. We will send you a magic link.
            </p>

            <Field label="Email" htmlFor="login-email" className="mt-6">
              <Input
                id="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </Field>

            <Button type="submit" disabled={loading} className="mt-4 w-full">
              {loading ? "Sending..." : "Send magic link"}
            </Button>

            {error && (
              <p className="mt-2 text-sm text-error">{error}</p>
            )}

            {/* Social sign-in (GitHub/Google) is hidden until OAuth is configured
                in production. Re-enable by restoring the buttons here — they call
                authClient.signIn.social({ provider, callbackURL: "/dashboards" }).
                Better-auth gates each provider on its *_CLIENT_ID env var, and the
                privacy policy must re-disclose Google/GitHub sign-in when shown. */}
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
