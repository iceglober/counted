"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@counted/ui/components/button";
import { Input } from "@counted/ui/components/input";
import { Field, FieldLabel } from "@counted/ui/components/field";
import { Alert, AlertDescription } from "@counted/ui/components/alert";
import { authProblem, authRequest } from "../lib/auth-request";
import { safeNext, signInPath } from "../lib/auth-navigation";

export function PasswordRecovery({ token, next, initialEmail = "", invalid = false }: { token?: string; next: string; initialEmail?: string; invalid?: boolean }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const destination = safeNext(next);
  const resetting = token !== undefined;
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true); setProblem(null);
    try {
      if (resetting) {
        const password = String(form.get("password"));
        if (password !== form.get("confirmation")) throw new Error("The passwords do not match.");
        await authRequest("/reset-password", { token, newPassword: password });
      } else {
        const redirectTo = new URL("/reset-password", window.location.origin);
        redirectTo.searchParams.set("next", destination);
        await authRequest("/request-password-reset", { email: String(form.get("email")), redirectTo: String(redirectTo) });
      }
      setDone(true);
    } catch (error) { setProblem(authProblem(error)); }
    finally { setPending(false); }
  };
  return <div className="space-y-5">
    {invalid && <Alert variant="destructive"><AlertDescription>This reset link has expired or was already used. Request another below.</AlertDescription></Alert>}
    {done ? <Alert><AlertDescription>{resetting ? "Your password is updated. Sign in with your new password." : "If an account exists for that address, a password reset link is on its way."}</AlertDescription></Alert> : <form onSubmit={submit} className="grid gap-5">
      {resetting ? <>
        <Field><FieldLabel htmlFor="new-password">New password</FieldLabel><Input id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} required disabled={pending} /></Field>
        <Field><FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel><Input id="confirm-password" name="confirmation" type="password" autoComplete="new-password" minLength={8} required disabled={pending} /></Field>
      </> : <Field><FieldLabel htmlFor="reset-email">Email</FieldLabel><Input id="reset-email" name="email" type="email" autoComplete="email" defaultValue={initialEmail} required disabled={pending} /></Field>}
      <Button type="submit" disabled={pending}>{pending ? "Please wait…" : resetting ? "Set new password" : "Send reset link"}</Button>
    </form>}
    {problem && <Alert variant="destructive"><AlertDescription>{problem}</AlertDescription></Alert>}
    <Link href={signInPath(destination)} className="inline-block text-sm underline underline-offset-4">Back to sign in</Link>
  </div>;
}
