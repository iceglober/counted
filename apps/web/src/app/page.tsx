import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError, serverApi } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * The shell.
 *
 * Rendered from the public API and nothing else: `/v1/me` is the same endpoint
 * any integrator can call, so there is no state here the API cannot report.
 * The surface itself — dashboards, projects, settings — is #66 to #69.
 */
export default async function Home() {
  const cookieHeader = (await cookies()).toString();
  const api = serverApi(cookieHeader.length > 0 ? cookieHeader : null, (await headers()).get("traceparent") ?? undefined);

  try {
    const me = await api<{ kind: string; principal: string; scopes: string[] }>("describeCaller");
    if (me.data.kind === "anonymous") redirect("/sign-in");

    return (
      <main>
        <h1>Counted</h1>
        <p>
          Signed in as <strong>{me.data.principal}</strong>.
        </p>
      </main>
    );
  } catch (error) {
    // A 401 means the cookie is gone or expired, which is not an error page —
    // it is being signed out.
    if (error instanceof ApiError && error.isUnauthenticated) redirect("/sign-in");
    throw error;
  }
}
