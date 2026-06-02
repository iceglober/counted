import type { Metadata } from "next";
import { getPost } from "../posts";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, Step } from "../post-layout";

const meta = getPost("ai-native-product-analytics-in-5-minutes")!;

export const metadata: Metadata = {
  title: `${meta.title} — Counted`,
  description: meta.description,
  alternates: { canonical: `/blog/${meta.slug}` },
  openGraph: { title: meta.title, description: meta.description, url: `/blog/${meta.slug}`, type: "article" },
};

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        Most analytics setups make you wire a consent banner before you can see a single number.
        Counted doesn&apos;t — no cookies, no PII, under 3KB. Here&apos;s the whole thing, start to
        live dashboard, in about five minutes.
      </Lead>

      <Step n={1} title="Create a project and copy your key">
        <P>
          Sign in, create a project, and copy its <strong>client key</strong> — it starts with{" "}
          <code className="font-mono text-text-primary">ck_</code>. Client keys are write-only and
          safe to ship in browser or app code; they can send events but can&apos;t read your data.
        </P>
      </Step>

      <Step n={2} title="Install the SDK">
        <P>The core SDK is zero-dependency and works in any JS runtime.</P>
        <div className="mt-3">
          <CodeBlock>{`npm install @counted/sdk
# or: bun add @counted/sdk`}</CodeBlock>
        </div>
      </Step>

      <Step n={3} title="Initialize and send your first event">
        <P>Create the client once, then track named events with whatever properties you care about.</P>
        <div className="mt-3">
          <CodeBlock>{`import { Analytics } from "@counted/sdk";

const counted = new Analytics({
  projectKey: "ck_your_project_key",
  host: "https://app.counted.dev",
});

counted.track("signup", { plan: "free", referrer: "blog" });`}</CodeBlock>
        </div>
        <P>
          Properties are plain values — strings, numbers, booleans. No user IDs, no emails, nothing
          that identifies a person. Sessions are ephemeral and in-memory only.
        </P>
      </Step>

      <Step n={4} title="Watch it land on a dashboard">
        <P>
          Open your project and you&apos;ll see the event arrive within a second or two. Add an
          insight — a count of <code className="font-mono text-text-primary">signup</code> broken
          down by <code className="font-mono text-text-primary">plan</code>, say — and you have a
          composable dashboard you can keep building on. Funnels and retention work the same way.
        </P>
      </Step>

      <Step n={5} title="(Optional) Auto-track a React or SPA app">
        <P>
          For a single-page app, <code className="font-mono text-text-primary">@counted/react</code>{" "}
          can emit a page view on every route change, so you don&apos;t hand-instrument navigation.
        </P>
        <div className="mt-3">
          <CodeBlock>{`npm install @counted/react`}</CodeBlock>
        </div>
      </Step>

      <P>
        That&apos;s it — instrumented, sending, and visible, without a cookie banner or a 50KB
        bundle. From here, compose the dashboard you actually want.
      </P>
    </PostLayout>
  );
}
