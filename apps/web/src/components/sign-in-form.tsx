"use client";

import { Button } from "@counted/ui/components/button";
import { Input } from "@counted/ui/components/input";
import { Field, FieldLabel } from "@counted/ui/components/field";
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@counted/ui/components/alert";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@counted/ui/components/tabs";
import { useState } from "react";
import Link from "next/link";
import { safeNext, signInPath } from "../lib/auth-navigation";

type Mode = "sign-in" | "register";
type Method = "password" | "register" | "link";

const MODES: readonly { readonly key: Mode; readonly label: string }[] = [
  { key: "sign-in", label: "Sign in" },
  { key: "register", label: "Create account" },
];

/** What each provider is called on its own button. An unknown id is shown as it came. */
const PROVIDER_NAMES: Readonly<Record<string, string>> = {
  github: "GitHub",
  google: "Google",
};

/** The provider's own routes, reached through the console's proxy mount. */
const ENDPOINT: Readonly<Record<Method, string>> = {
  password: "/api/auth/sign-in/email",
  register: "/api/auth/sign-up/email",
  link: "/api/auth/sign-in/magic-link",
};

export const SignInForm = ({
  providers = [],
  next = "/",
  emailEnabled = true,
}: {
  readonly providers?: readonly string[];
  readonly next?: string;
  readonly emailEnabled?: boolean;
}) => {
  const destination = safeNext(next);
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [pendingMethod, setPendingMethod] = useState<Method | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  /**
   * Hand the browser to the provider.
   *
   * Two navigations, not one: this POST only *asks* for the authorization URL,
   * and the redirect that follows has to be a real navigation off this origin.
   * The callback comes back to this origin — the API tells the provider so —
   * where the proxy forwards it and the session cookie lands here, on the
   * origin that will send it back.
   */
  const continueWith = async (provider: string) => {
    setPending(true);
    setProblem(null);
    setSent(false);
    try {
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          callbackURL: `${window.location.origin}${destination}`,
          errorCallbackURL: `${window.location.origin}${signInPath(destination)}`,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const url =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { url?: unknown }).url === "string"
          ? (payload as { url: string }).url
          : null;
      if (!response.ok || url === null) {
        setProblem(
          `${PROVIDER_NAMES[provider] ?? provider} sign-in is not available.`,
        );
        return;
      }
      window.location.assign(url);
    } catch {
      setProblem("The API could not be reached.");
    } finally {
      setPending(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const method: Method =
      mode === "register"
        ? "register"
        : submitter?.getAttribute("value") === "link"
          ? "link"
          : "password";
    if (method === "password" && !showPassword) {
      setShowPassword(true);
      setProblem(null);
      setSent(false);
      return;
    }
    setPendingMethod(method);
    setPending(true);
    setProblem(null);
    setSent(false);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "");

    const body =
      method === "link"
        ? // Absolute, on the console's own origin: the provider resolves a bare
          // path against its own mount, which lands a finished sign-in on the
          // API's root. A link that fails — expired, already used — comes back
          // to this page with `?error=`, where the page explains it.
          {
            email,
            callbackURL: `${window.location.origin}${destination}`,
            errorCallbackURL: `${window.location.origin}${signInPath(destination)}`,
          }
        : method === "register"
          ? { email, password, name }
          : { email, password };

    try {
      const response = await fetch(ENDPOINT[method], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const message =
          typeof payload === "object" &&
          payload !== null &&
          typeof (payload as { message?: unknown }).message === "string"
            ? (payload as { message: string }).message
            : "That did not work.";
        setProblem(message);
        return;
      }

      if (method === "link") {
        setSent(true);
        return;
      }
      // A full navigation rather than a router push: the session cookie was
      // just set, and every server component on the next page has to be
      // rendered with it.
      window.location.assign(destination);
    } catch {
      setProblem("The API could not be reached.");
    } finally {
      setPending(false);
      setPendingMethod(null);
    }
  };

  return (
    <div className="space-y-6">
      {providers.length > 0 && (
        <div className="grid gap-3">
          {providers.map((provider) => (
            <Button
              key={provider}
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => void continueWith(provider)}
            >
              Continue with {PROVIDER_NAMES[provider] ?? provider}
            </Button>
          ))}
        </div>
      )}
      <Tabs
        value={mode}
        onValueChange={(value) => {
          setMode(value as Mode);
          setShowPassword(false);
          setProblem(null);
          setSent(false);
        }}
      >
        <TabsList
          aria-label="How to sign in"
          className="grid w-full grid-cols-2 group-data-horizontal/tabs:h-auto"
        >
          {MODES.map((entry) => (
            <TabsTrigger
              key={entry.key}
              value={entry.key}
              disabled={pending}
              className="min-h-11 px-2 whitespace-normal"
            >
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={mode} className="pt-5">
          <form onSubmit={submit} className="grid gap-5">
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={pending}
              />
            </Field>
            {mode === "register" && (
              <Field>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input
                  id="name"
                  name="name"
                  required
                  autoComplete="name"
                  disabled={pending}
                />
              </Field>
            )}
            {(mode === "register" || showPassword) && (
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete={
                    mode === "register" ? "new-password" : "current-password"
                  }
                  disabled={pending}
                  autoFocus={mode === "sign-in"}
                />
                {mode === "sign-in" && emailEnabled && <Link className="text-sm underline underline-offset-4" href={`/forgot-password?${new URLSearchParams({ next: destination, email })}`}>Forgot password?</Link>}
              </Field>
            )}
            <div className="mt-1 grid gap-3">
              <Button type="submit" value="password" disabled={pending}>
                {pending && pendingMethod !== "link"
                  ? mode === "register"
                    ? "Creating account…"
                    : "Signing in…"
                  : mode === "register"
                    ? "Create account"
                    : showPassword
                      ? "Sign in"
                      : "Sign in with password"}
              </Button>
              {mode === "sign-in" && emailEnabled &&
                (showPassword ? (
                  <Button
                    key="choose-method"
                    type="button"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      setShowPassword(false);
                      setProblem(null);
                    }}
                  >
                    Use a sign-in link instead
                  </Button>
                ) : (
                  <Button
                    key="send-link"
                    type="submit"
                    value="link"
                    variant="outline"
                    disabled={pending}
                  >
                    {pendingMethod === "link"
                      ? "Sending link…"
                      : "Sign in with link"}
                  </Button>
                ))}
            </div>
          </form>
        </TabsContent>
      </Tabs>
      {problem && (
        <Alert variant="destructive">
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}
      {sent && (
        <Alert>
          <AlertTitle>Check your email</AlertTitle>
          <AlertDescription>Your sign-in link is on its way.</AlertDescription>
        </Alert>
      )}
    </div>
  );
};
