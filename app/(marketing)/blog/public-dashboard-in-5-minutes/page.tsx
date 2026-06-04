import type { Metadata } from "next";
import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, Step } from "../post-layout";

const meta = getPost("public-dashboard-in-5-minutes")!;

export const metadata: Metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        With Counted you can build a dashboard and publish it as a read-only link anyone can open —
        no login, no signup. Good for a status page, a launch metric, or open startup metrics.
      </Lead>

      <Step n={1} title="Send some events">
        <P>
          You need data to chart. If you haven&apos;t instrumented yet, it&apos;s two lines — see{" "}
          <a href="/blog/ai-native-product-analytics-in-5-minutes" className="text-accent hover:text-accent-hover transition-colors">
            Set up AI-native product analytics in 5 minutes
          </a>
          . The short version:
        </P>
        <div className="mt-3">
          <CodeBlock>{`import { Analytics } from "@counted/sdk";

const counted = new Analytics({ projectKey: "ck_..." });
counted.track("signup", { plan: "free" });`}</CodeBlock>
        </div>
      </Step>

      <Step n={2} title="Build a dashboard">
        <P>
          In your project, create a dashboard and add insights — a count of <code className="font-mono text-text-primary">signup</code>{" "}
          over time, a breakdown by plan, a funnel, whatever you want to show. Each insight is its
          own query; rearrange and resize until it reads well.
        </P>
      </Step>

      <Step n={3} title="Make it public">
        <P>
          Open the dashboard&apos;s share option and enable the public link. Counted mints a
          read-only URL backed by a random token:
        </P>
        <div className="mt-3">
          <CodeBlock>{`https://app.counted.dev/share/3f9a…  ← read-only, no login`}</CodeBlock>
        </div>
        <P>
          Visitors see the live dashboard but can&apos;t edit anything or reach the rest of your
          account. Revoke the link any time and the URL stops working.
        </P>
      </Step>

      <Step n={4} title="Put it where people will see it">
        <P>
          Drop the link in your README, a status page, an investor update, or a launch tweet. Since
          it&apos;s live, it stays current on its own — no screenshots to refresh.
        </P>
        <P>
          Counted is privacy-first, so a public dashboard never exposes anyone&apos;s personal data —
          there&apos;s none to expose. Just your metrics.
        </P>
      </Step>
    </PostLayout>
  );
}
