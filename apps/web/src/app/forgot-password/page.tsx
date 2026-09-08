import { CenteredPage } from "../../components/layout";
import { Card, CardContent, CardHeader, CardDescription } from "@counted/ui/components/card";
import { PasswordRecovery } from "../../components/password-recovery";
import { safeNext } from "../../lib/auth-navigation";
import { emailAvailable } from "../../lib/auth-capabilities";
import Link from "next/link";

export default async function ForgotPassword({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  if (!await emailAvailable()) return <CenteredPage><Card><CardHeader><h1 className="font-heading text-xl">Password recovery unavailable</h1><CardDescription>Email delivery has not been configured. Contact your Counted administrator for help accessing your account.</CardDescription></CardHeader><CardContent><Link className="text-sm underline underline-offset-4" href="/sign-in">Back to sign in</Link></CardContent></Card></CenteredPage>;
  return <CenteredPage><Card><CardHeader><h1 className="font-heading text-xl">Reset your password</h1><CardDescription>We’ll email a link to choose a new password.</CardDescription></CardHeader><CardContent><PasswordRecovery next={safeNext(query.next)} initialEmail={typeof query.email === "string" ? query.email : ""} /></CardContent></Card></CenteredPage>;
}
