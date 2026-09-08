import { CenteredPage } from "../../components/layout";
import { Card, CardContent, CardHeader, CardDescription } from "@counted/ui/components/card";
import { PasswordRecovery } from "../../components/password-recovery";
import { safeNext } from "../../lib/auth-navigation";
import { emailAvailable } from "../../lib/auth-capabilities";
import Link from "next/link";

export default async function ResetPassword({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const token = typeof query.token === "string" && query.error === undefined ? query.token : undefined;
  if (!token && !await emailAvailable()) return <CenteredPage><Card><CardHeader><h1 className="font-heading text-xl">Password recovery unavailable</h1><CardDescription>Email delivery has not been configured. Contact your Counted administrator for a new reset link.</CardDescription></CardHeader><CardContent><Link className="text-sm underline underline-offset-4" href="/sign-in">Back to sign in</Link></CardContent></Card></CenteredPage>;
  return <CenteredPage><Card><CardHeader><h1 className="font-heading text-xl">{token ? "Choose a new password" : "Request a new reset link"}</h1><CardDescription>{token ? "At least eight characters. Other signed-in sessions will be ended." : "Reset links can only be used once."}</CardDescription></CardHeader><CardContent><PasswordRecovery {...(token ? { token } : {})} next={safeNext(query.next)} invalid={!token} /></CardContent></Card></CenteredPage>;
}
