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

            <div className="mt-6 pt-6 border-t border-border">
              <p className="text-xs text-text-tertiary text-center mb-3">or continue with</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => authClient.signIn.social({ provider: "github", callbackURL: "/dashboards" })}
                  className="flex-1 text-text-secondary hover:text-text-primary"
                >
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                  GitHub
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => authClient.signIn.social({ provider: "google", callbackURL: "/dashboards" })}
                  className="flex-1 text-text-secondary hover:text-text-primary"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  Google
                </Button>
              </div>
            </div>
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
