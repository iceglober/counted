import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, Step } from "../post-layout";

const meta = getPost("sveltekit-analytics-in-5-minutes")!;

export const metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        <code className="font-mono text-text-primary">@counted/sdk</code> drops into any
        SvelteKit app without a cookie banner or a 50KB script. Here&apos;s the whole
        thing — a shared analytics module, auto page views on every route, and a custom
        event — in about five minutes.
      </Lead>

      <Step n={1} title="Get a project key">
        <P>
          Create a project and copy its <strong>client key</strong> (starts with{" "}
          <code className="font-mono text-text-primary">ck_</code>) — or mint one with no
          signup:
        </P>
        <div className="mt-3">
          <CodeBlock>{`curl -X POST https://app.counted.dev/api/v0/provision`}</CodeBlock>
        </div>
        <P>
          Add it to your <code className="font-mono text-text-primary">.env</code>. SvelteKit
          only exposes env vars with the{" "}
          <code className="font-mono text-text-primary">PUBLIC_</code> prefix to the browser
          bundle — so that&apos;s the prefix to use here:
        </P>
        <div className="mt-3">
          <CodeBlock>{`# .env\nPUBLIC_COUNTED_PROJECT_KEY=ck_your_project_key`}</CodeBlock>
        </div>
        <P>Client keys are write-only — safe to ship in the browser.</P>
      </Step>

      <Step n={2} title="Install the SDK">
        <div className="mt-1">
          <CodeBlock>{`npm install @counted/sdk`}</CodeBlock>
        </div>
      </Step>

      <Step n={3} title="Create a shared analytics module">
        <P>
          Create <code className="font-mono text-text-primary">src/lib/analytics.ts</code>.
          A module-level singleton means you import the same instance everywhere — no
          context or stores needed.
        </P>
        <P>
          The <code className="font-mono text-text-primary">browser</code> check is
          important: SvelteKit runs your code on the server during SSR, where{" "}
          <code className="font-mono text-text-primary">window</code> doesn&apos;t exist.
          Guarding with <code className="font-mono text-text-primary">browser</code> keeps
          the server build clean.
        </P>
        <div className="mt-3">
          <CodeBlock>{`// src/lib/analytics.ts\nimport { browser } from '$app/environment';\nimport { Analytics } from '@counted/sdk';\nimport { PUBLIC_COUNTED_PROJECT_KEY } from '$env/static/public';\n\nexport const analytics = browser\n  ? new Analytics({ projectKey: PUBLIC_COUNTED_PROJECT_KEY })\n  : null;`}</CodeBlock>
        </div>
      </Step>

      <Step n={4} title="Auto-track page views">
        <P>
          SvelteKit&apos;s{" "}
          <code className="font-mono text-text-primary">afterNavigate</code> fires after
          every client-side navigation — including the first one when the app mounts. One
          hook covers initial views and route changes with no extra wiring.
        </P>
        <P>
          Add it to your root layout:
        </P>
        <div className="mt-3">
          <CodeBlock>{`<!-- src/routes/+layout.svelte -->\n<script>\n  import { afterNavigate } from '$app/navigation';\n  import { analytics } from '$lib/analytics';\n\n  let { children } = $props();\n\n  afterNavigate(({ to }) => {\n    analytics?.track('page_view', { path: to?.url.pathname ?? '/' });\n  });\n</script>\n\n{@render children()}`}</CodeBlock>
        </div>
        <P>
          From here, every page your users visit appears in the dashboard as a{" "}
          <code className="font-mono text-text-primary">page_view</code> event. You can
          break it down by path, build funnels, or compare cohorts — all from the same
          event shape.
        </P>
      </Step>

      <Step n={5} title="Track a custom event">
        <P>
          Import <code className="font-mono text-text-primary">analytics</code> in any
          component and call <code className="font-mono text-text-primary">track()</code>.
          Properties are plain values — no user IDs, no PII.
        </P>
        <div className="mt-3">
          <CodeBlock>{`<!-- src/lib/UpgradeButton.svelte -->\n<script>\n  import { analytics } from '$lib/analytics';\n</script>\n\n<button onclick={() => analytics?.track('upgrade_click', { plan: 'pro' })}>\n  Upgrade\n</button>`}</CodeBlock>
        </div>
        <P>
          Your event shows up on the dashboard within a second or two. Add as many
          properties as you want — breakdowns, time series, and funnels compose from
          whatever shape you send.
        </P>
      </Step>
    </PostLayout>
  );
}
