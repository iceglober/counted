import type { Metadata } from "next";
import { SiteHeader } from "../../components/site-header";
import { publicUrls } from "../../lib/deployment";

export const metadata: Metadata = {
  title: "Get started · Counted",
  alternates: { canonical: "/getting-started" },
};
export default function GetStarted() {
  const urls = publicUrls();
  const options = `key: "YOUR_INGEST_KEY"${
    urls.api === "https://api.counted.dev"
      ? ""
      : `, endpoint: "${urls.api}/v1/events"`
  }`;
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl space-y-10 px-5 py-12 text-sm leading-relaxed sm:px-8 sm:py-16">
        <header className="space-y-4 border-b pb-8">
          <p className="text-xs text-muted-foreground">
            Counted for developers
          </p>
          <h1 className="font-heading text-4xl">
            Your first event in a few lines.
          </h1>
          <p className="text-base text-muted-foreground">
            Create a project, track an action, and see it arrive.
          </p>
        </header>
        <section className="space-y-4">
          <h2 className="font-heading text-2xl">1. Create a project</h2>
          <p>
            <a
              className="text-primary-ink underline underline-offset-4"
              href={urls.console}
            >
              Open the app
            </a>{" "}
            and choose <strong>Projects → New project</strong>. Name it. Your
            project opens with its first ingest key already in the setup code.
          </p>
          <p className="text-muted-foreground">
            Copy the code before leaving: keys are shown only once. An ingest
            key is safe to embed in your app and can only send events to that
            project. For an existing project, use a saved ingest key or create
            one from its Overview or Keys page.
          </p>
        </section>
        <section className="space-y-4">
          <h2 className="font-heading text-2xl">2. Track an action</h2>
          <pre className="whitespace-pre-wrap break-all border bg-muted/30 p-5 font-mono text-xs leading-6">
            <code>npm install @counted/sdk</code>
          </pre>
          <pre className="whitespace-pre-wrap break-all border bg-muted/30 p-5 font-mono text-xs leading-6">
            <code>{`import { Counted } from "@counted/sdk";\n\nconst counted = new Counted({ ${options} });\ncounted.track("page_view", { path: "/welcome" });`}</code>
          </pre>
          <p>
            Create one client per app. Call <code>track()</code> when an action
            happens. The SDK handles batching, retries, duplicate protection,
            and temporary visits in memory. In the browser, it sends queued
            events automatically.
          </p>
          <p>
            In a short-lived Node.js or Bun script, finish with{" "}
            <code>await counted.shutdown()</code> to flush queued events before
            exiting. In serverless handlers, create the client within the
            invocation and await shutdown before returning.
          </p>
          <p className="text-muted-foreground">
            Use stable event names and bounded properties such as a route
            template, feature name, or plan. Do not send emails, names, tokens,
            user-written text, or URLs containing personal data. No analytics
            cookies or persistent device identifiers are created.
          </p>
        </section>
        <section className="space-y-4">
          <h2 className="font-heading text-2xl">3. See it arrive</h2>
          <p>
            Trigger the action in your app with the project Overview open.{" "}
            <strong>Live events</strong> updates automatically with event names
            and counts for the last 24 hours. Allow a few seconds for batching
            and the next refresh.
          </p>
          <p>
            Once events appear, create a dashboard and add an Insight. Start
            with an event count, a trend, or a breakdown by one of your
            properties.
          </p>
          <p className="text-muted-foreground">
            If nothing arrives, check the ingest key, project status, and
            outgoing request to <code>{urls.api}/v1/events</code>. A receipt
            reports accepted, deduplicated, and rejected events. Network
            blockers and exhausted workspace quotas can prevent collection.
          </p>
        </section>
        <section className="space-y-4">
          <h2 className="font-heading text-2xl">What you can measure today</h2>
          <p>
            Event counts, unique visits, trends, property breakdowns, and
            ordered visit funnels. Visits group temporary activity; they do not
            count distinct people.
          </p>
          <p>
            Distinct-person or account analytics, cross-visit retention, and
            sums of arbitrary numeric properties are not available yet. Sending
            an ID or a number does not enable those analyses. Do not collect an
            identifier solely for an unavailable query.
          </p>
          <p>
            For API integrations,{" "}
            <code>GET /v1/projects/{"{projectId}"}/schema</code> lists observed
            events, dimensions, declared measures, and executable capabilities.
            Only listed measures can be summed; an empty measures list means no
            numeric sums are available.
          </p>
        </section>
        <section className="space-y-4 border-t pt-6">
          <h2 className="font-heading text-2xl">Go further when you need to</h2>
          <p>
            <a
              className="text-primary-ink underline underline-offset-4"
              href="https://github.com/iceglober/counted#packages"
            >
              React, Python, Go, and Rust SDKs
            </a>{" "}
            ·{" "}
            <a
              className="text-primary-ink underline underline-offset-4"
              href="/api-guide"
            >
              HTTP, service keys, and anonymous provisioning
            </a>{" "}
            ·{" "}
            <a
              className="text-primary-ink underline underline-offset-4"
              href="/"
            >
              API reference
            </a>
          </p>
          <p className="text-muted-foreground">
            Service keys and OAuth are for querying and managing Counted from
            other tools. Sending events with an SDK needs only the project’s
            ingest key.
          </p>
        </section>
      </main>
    </>
  );
}
