import { CenteredPage } from "../../components/layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardDescription,
} from "@counted/ui/components/card";
import { Alert, AlertDescription } from "@counted/ui/components/alert";
/**
 * The sign-in page. The console holds no session of its own — this hands off to
 * the provider through the proxy and the cookie it sets is the only thing that
 * makes the rest of the console work.
 */

import { SignInForm } from "../../components/sign-in-form";
import { apiOrigin } from "../../lib/env";
import { safeNext } from "../../lib/auth-navigation";
import { emailAvailable } from "../../lib/auth-capabilities";

export const dynamic = "force-dynamic";

/**
 * Read on the server so the page arrives with its buttons already on it: a
 * list fetched from the browser would flash a sign-in form that grows a
 * "Continue with GitHub" a moment later.
 *
 * An unreachable API means no social buttons rather than no page — email and
 * password still work, and a sign-in page that 500s because a list could not
 * be read would be a worse answer than a shorter one.
 */
const socialProviders = async (): Promise<readonly string[]> => {
  try {
    const response = await fetch(`${apiOrigin()}/api/auth/providers`, {
      cache: "no-store",
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const listed = (body as { providers?: unknown }).providers;
    return Array.isArray(listed)
      ? listed.filter((one): one is string => typeof one === "string")
      : [];
  } catch {
    return [];
  }
};

/**
 * What a failed sign-in link says when it lands back here. The provider's
 * codes are an internal vocabulary; the person clicked something that used to
 * work, and needs to know only that it is time to ask for another one.
 */
const LINK_PROBLEMS: Readonly<Record<string, string>> = {
  INVALID_TOKEN:
    "That sign-in link has expired or was already used. Request a new one below.",
  EXPIRED_TOKEN: "That sign-in link has expired. Request a new one below.",
};

type SignInProps = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const SignIn = async ({ searchParams }: SignInProps) => {
  const [query, providers, emailEnabled] = await Promise.all([
    searchParams,
    socialProviders(),
    emailAvailable(),
  ]);
  const { error } = query;
  const oauth = typeof query.sig === "string" && typeof query.client_id === "string";
  const oauthQuery = new URLSearchParams();
  if (oauth) for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) value.forEach((one) => oauthQuery.append(key, one));
    else if (value !== undefined) oauthQuery.set(key, value);
  }
  const next = oauth ? `/oauth/continue?${oauthQuery}` : safeNext(query.next);
  const code = Array.isArray(error) ? error[0] : error;
  const problem =
    code === undefined
      ? null
      : (LINK_PROBLEMS[code] ??
        "That sign-in link did not work. Request a new one below.");
  return (
    <CenteredPage>
      <Card>
        <CardHeader>
          <h1 className="font-heading text-xl">Sign in to Counted</h1>
          <CardDescription>
            Your projects, dashboards, and a clearer picture.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {problem && (
            <Alert variant="destructive">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          )}
          <SignInForm providers={providers} next={next} emailEnabled={emailEnabled} />
        </CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        Privacy-first analytics. No tracking cookies.
      </p>
    </CenteredPage>
  );
};

export default SignIn;
