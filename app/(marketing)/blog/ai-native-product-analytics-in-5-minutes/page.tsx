import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, H2 } from "../post-layout";

const meta = getPost("ai-native-product-analytics-in-5-minutes")!;

export const metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        I&apos;m tired of two things in an analytics setup: the cookie-consent banner, and the 50KB
        script that loads before my own app does. Counted has neither — and the same SDK also
        instruments your AI agents. Here&apos;s the five-minute version.
      </Lead>

      <H2>Two lines to your first event</H2>
      <P>
        Grab a write-only client key. No signup required — mint one from your terminal (it returns a{" "}
        <code className="font-mono text-text-primary">ck_…</code> key plus a link to claim the project
        later):
      </P>
      <div className="mt-3">
        <CodeBlock>{`curl -X POST https://app.counted.dev/api/v0/provision`}</CodeBlock>
      </div>
      <P>Then install the zero-dependency SDK and send something:</P>
      <div className="mt-3">
        <CodeBlock>{`npm install @counted/sdk`}</CodeBlock>
      </div>
      <div className="mt-3">
        <CodeBlock>{`import { Analytics } from "@counted/sdk";

const counted = new Analytics({ projectKey: "ck_your_key" });
counted.track("signup", { plan: "free" });`}</CodeBlock>
      </div>
      <P>
        Open the project and the event is there within a second or two. Properties are plain values —
        strings, numbers, booleans — and that&apos;s deliberate: there&apos;s no field for a user id
        or an email, because Counted doesn&apos;t store them.
      </P>

      <H2>Why there&apos;s no cookie</H2>
      <P>
        The session id is generated in memory when the SDK starts and lives as long as the tab or
        process does. Nothing is written to a cookie, to localStorage, or to disk — when the session
        ends, it&apos;s gone. So you&apos;re counting <em>events and sessions</em>, not people.
      </P>
      <P>
        The trade: you can&apos;t follow one human across devices and weeks. What you get back is a
        number you can stand behind, GDPR/CCPA-friendly, with no consent banner. For most product
        questions (&quot;did this funnel improve?&quot;, &quot;which feature gets used?&quot;) that&apos;s
        the data you wanted.
      </P>

      <H2>The one gotcha: flush before a short-lived process exits</H2>
      <P>
        The SDK batches events and flushes on a timer. In the browser it also flushes when the tab is
        hidden, so you rarely think about it. But in a <strong>short-lived process</strong> — a
        serverless function, a CLI, a cron job — the process can exit before that timer fires and drop
        the last batch. Flush explicitly before you exit:
      </P>
      <div className="mt-3">
        <CodeBlock>{`counted.track("job_finished", { processed: 128 });
await counted.flush();   // don't lose the last batch`}</CodeBlock>
      </div>
      <p className="mt-4 text-sm text-text-tertiary leading-relaxed">
        (This is the single thing people trip on. The browser and long-running servers handle it for
        you; ephemeral runtimes don&apos;t.)
      </p>

      <H2>Same SDK, your agents too</H2>
      <P>
        An agent&apos;s actions are just events.{" "}
        <code className="font-mono text-text-primary">track(&quot;tool_use&quot;, {`{ tool, outcome }`})</code>{" "}
        is the same shape as <code className="font-mono text-text-primary">track(&quot;signup&quot;, {`{ plan }`})</code>.
        So you instrument your product <em>and</em> your AI coding agents with one SDK and read both
        in the same composable dashboards — funnels, breakdowns, time series.
      </P>
      <P>
        If agents are why you&apos;re here, skip straight to{" "}
        <a href="/blog/claude-code-eval-in-5-minutes" className="text-accent hover:text-accent-hover transition-colors">
          tracking a Claude Code eval in 5 minutes
        </a>{" "}
        — same idea, with the native plugin doing the instrumentation for you.
      </P>

      <P>
        That&apos;s it — instrumented and visible, no banner, no 50KB bundle, one event model for your
        users and your agents.
      </P>
    </PostLayout>
  );
}
