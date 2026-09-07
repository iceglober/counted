import type { Metadata } from "next";
import { SiteHeader } from "../../components/site-header";
import { publicUrls } from "../../lib/deployment";

export const metadata: Metadata = {
  title: "Get started · Counted",
  alternates: { canonical: "/getting-started" },
};
export default function GetStarted() {
  const urls = publicUrls();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl space-y-10 px-5 py-12 text-sm leading-relaxed sm:px-8 sm:py-16">
        <header className="space-y-4 border-b pb-8">
          <p className="text-xs text-muted-foreground">
            Counted for developers
          </p>
          <h1 className="font-heading text-4xl">One API, your tools.</h1>
          <p className="text-base text-muted-foreground">
            Collect events, ask questions, and manage your workspace from code
            or the API Explorer.
          </p>
        </header>
        <section className="space-y-4">
          <h2 className="font-heading text-2xl">Start without an account</h2>
          <p>Send <code>POST /v1/projects/provision</code> with an optional project name. The response contains a working ingest key, a project ID, and an expiring claim token. Keep the claim token private.</p>
          <p>When you are ready to keep the project, <a className="text-primary-ink underline underline-offset-4" href={`${urls.console}/claim`}>claim it in the app</a>. Sign in or create an account, choose a workspace, and paste the project ID and claim token. You need permission to create projects in that workspace and an available project slot. Existing events and the ingest key are retained.</p>
          <p className="text-muted-foreground">Automation can use <code>POST /v1/projects/{"{projectId}"}/claim</code> with a service key authorized for the destination workspace. The claim token proves ownership of the unclaimed project; it does not replace workspace authorization.</p>
        </section>
        <section className="space-y-4">
          <h2 className="font-heading text-2xl">Make your first request</h2>
          <p>
            Open{" "}
            <a
              className="text-primary-ink underline underline-offset-4"
              href={`${urls.console}/api-explorer`}
            >
              API Explorer
            </a>{" "}
            in the Counted app. Choose an operation and send a request using
            your signed-in session. Workspace fields start with your current
            workspace; you can edit every input.
          </p>
          <p>
            For an integration, create a service key in your project’s Keys
            page. Send it as a bearer token to{" "}
            <code>{urls.api}</code>.
          </p>
          <pre
            tabIndex={0}
            className="overflow-x-auto border bg-muted/30 p-5 font-mono text-xs leading-6"
          >
            <code>
              {
                `curl ${urls.api}/v1/me \\\n  -H "Authorization: Bearer $COUNTED_SERVICE_KEY"`
              }
            </code>
          </pre>
          <p className="text-muted-foreground">
            A service key’s access is limited by its permissions, project or
            workspace scope, and the issuing member’s role.
          </p>
        </section>
        <section className="space-y-4">
          <h2 className="font-heading text-2xl">Collect events</h2>
          <p>
            Use a project’s ingest key with a{" "}
            <a
              className="text-primary-ink underline underline-offset-4"
              href="https://github.com/iceglober/counted#packages"
            >
              Counted SDK
            </a>
            . The SDK handles batching, retries, and ephemeral visits. An ingest
            key can write events to one project; it cannot read analytics or
            manage your workspace.
          </p>
          <p>
            Direct ingestion uses <code>POST /v1/events</code> with a JSON body
            containing an <code>events</code> array and an{" "}
            <code>Authorization: Bearer</code> header. A <code>202</code>{" "}
            response acknowledges a durable write and reports accepted,
            deduplicated, and rejected events. Inspect any per-event outcomes; a
            successful batch can still contain rejected events.
          </p>
          <pre tabIndex={0} className="overflow-x-auto border bg-muted/30 p-5 font-mono text-xs leading-6">
            <code>{String.raw`COUNTED_VISIT_ID=$(uuidgen)
curl ${urls.api}/v1/events \
  -H "Authorization: Bearer $COUNTED_INGEST_KEY" \
  -H "Content-Type: application/json" \
  --data "{\"events\":[{\"name\":\"page_view\",\"visitId\":\"$COUNTED_VISIT_ID\",\"properties\":{\"url\":\"/pricing\"}}]}"`}</code>
          </pre>
          <p>
            This one-off request uses a fresh visit id and the server’s receipt
            time. In an application, let the SDK keep visits in memory and
            supply an <code>occurredAt</code> timestamp and unique
            <code> idempotencyKey</code> for every event. Keep both unchanged
            when retrying an event so it can be deduplicated. Never store a
            visit id in a cookie or local storage.
          </p>
          <p>
            In API Explorer, choose <strong>Events → Ingest events</strong>.
            Enter the project’s ingest key, edit the generated event fields or
            JSON, and send. The sample contains a fresh visit, timestamp, and
            event key. A signed-in session cannot ingest; the project is
            determined entirely by the key.
          </p>
          <p>
            Custom properties are flat strings, numbers, booleans, or null. For
            example, <code>{`{"url":"/pricing","campaign":"launch"}`}</code>
            can become filters or breakdown dimensions in an Insight. Omit
            personal data. Geography comes from the request at the edge; the IP
            address is discarded and client-supplied country values are ignored.
          </p>
          <p className="text-muted-foreground">
            The reference includes ingestion schemas from the same wire contract
            as the dedicated group-commit handler. Authentication remains under
            the provider’s <code>/api/auth/</code> routes, which the Explorer’s
            Custom request tab can call through the app’s API proxy.
          </p>
        </section>
        <section className="space-y-4">
          <h2 className="font-heading text-2xl">Read the receipt before retrying</h2>
          <pre tabIndex={0} className="overflow-x-auto border bg-muted/30 p-5 font-mono text-xs leading-6">
            <code>{JSON.stringify({ accepted: 1, deduplicated: 0, rejected: 1, outcomes: [{ index: 1, accepted: false, reason: "MalformedEvent" }] }, null, 2)}</code>
          </pre>
          <p>
            Here the first event is stored and the second is rejected.
            <code> outcomes</code> uses zero-based indexes from your submitted
            array and lists only rejected events. Fix those events before
            submitting them again. A deduplicated event is already stored;
            nothing more is required. With no rejections, <code>outcomes</code>
            is omitted.
          </p>
          <table className="w-full border-collapse text-left">
            <thead><tr className="border-b"><th className="py-3 pr-4 font-medium">Status</th><th className="py-3 font-medium">Next step</th></tr></thead>
            <tbody>
              {[
                ["202", "Inspect accepted, deduplicated, rejected, and any per-event outcomes."],
                ["400 / 413", "Correct the JSON or split the batch. Defaults allow 250 events and 1 MiB."],
                ["401 / 403 / 404", "Check the key, its project, and events:write permission. Do not retry unchanged."],
                ["402", "Resolve the workspace quota or wait for its next usage period."],
                ["429", "Wait at least Retry-After seconds, then retry with the same event keys and timestamps."],
                ["503", "Back off and retry with the same event keys and timestamps."],
              ].map(([status, action]) => <tr key={status} className="border-b"><td className="whitespace-nowrap py-3 pr-4 align-top font-mono text-xs">{status}</td><td className="py-3">{action}</td></tr>)}
            </tbody>
          </table>
          <p className="text-muted-foreground">
            Whole-batch failures include <code>code</code>, <code>detail</code>,
            and <code>retryable</code>. Limits may differ on a self-hosted
            deployment. The full reference describes every field and response.
          </p>
        </section>
        <section className="space-y-4">
          <h2 className="font-heading text-2xl">Build with the contract</h2>
          <p>
            The{" "}
            <a
              className="text-primary-ink underline underline-offset-4"
              href="/"
            >
              API reference
            </a>{" "}
            includes request fields, response schemas, errors, and examples for
            every oRPC operation. Download the{" "}
            <a
              className="text-primary-ink underline underline-offset-4"
              href="/openapi.json"
            >
              OpenAPI 3.1 document
            </a>{" "}
            to generate a client or import it into your API tools.
          </p>
          <p>
            In the Explorer, switch between generated forms and JSON for complex
            requests. Choose a service or ingest key to test its exact
            permissions, or use a share token for a shared dashboard. Entered
            keys and request contents stay in memory while you use the page.
          </p>
        </section>
        <footer className="border-t pt-6 text-xs text-muted-foreground">
          Counted · Privacy-focused app analytics
        </footer>
      </main>
    </>
  );
}
