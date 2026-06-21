import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, Step } from "../post-layout";

const meta = getPost("astro-analytics-in-5-minutes")!;

export const metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        <code className="font-mono text-text-primary">@counted/sdk</code> drops into any
        Astro site — static, SSR, or hybrid — without a cookie banner or a 50KB script.
        Here&apos;s the whole thing: a shared analytics module, automatic page views, and
        a custom event, in about five minutes.
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
          Add it to your{" "}
          <code className="font-mono text-text-primary">.env</code>. Astro (via Vite)
          only exposes env vars with the{" "}
          <code className="font-mono text-text-primary">PUBLIC_</code> prefix to the
          browser — so that&apos;s the prefix to use here:
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
          Create{" "}
          <code className="font-mono text-text-primary">src/lib/analytics.ts</code>.
          Astro&apos;s{" "}
          <code className="font-mono text-text-primary">&lt;script&gt;</code> tags are
          bundled by Vite and always run in the browser — no SSR guard is needed here.
        </P>
        <div className="mt-3">
          <CodeBlock>{`// src/lib/analytics.ts\nimport { Analytics } from '@counted/sdk';\n\nexport const analytics = new Analytics({\n  projectKey: import.meta.env.PUBLIC_COUNTED_PROJECT_KEY,\n});`}</CodeBlock>
        </div>
      </Step>

      <Step n={4} title="Auto-track page views">
        <P>
          In your root layout, add a{" "}
          <code className="font-mono text-text-primary">&lt;script&gt;</code> tag. Astro
          resolves imports inside script tags at build time — you can import the shared
          module directly.
        </P>
        <P>
          The two-liner below tracks the initial page view, then re-tracks after each{" "}
          <a
            href="https://docs.astro.build/en/guides/view-transitions/"
            className="text-accent-primary hover:underline"
          >
            View Transition
          </a>{" "}
          swap. If your site doesn&apos;t use View Transitions, the event listener is a
          no-op — the first{" "}
          <code className="font-mono text-text-primary">track()</code> call covers the
          initial page view.
        </P>
        <div className="mt-3">
          <CodeBlock>{`<!-- src/layouts/Layout.astro -->\n---\nconst { title } = Astro.props;\n---\n\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>{title}</title>\n  </head>\n  <body>\n    <slot />\n  </body>\n  <script>\n    import { analytics } from '../lib/analytics';\n\n    // Track initial page view\n    analytics.track('page_view', { path: window.location.pathname });\n\n    // Re-track after each View Transition swap (no-op if VT is disabled)\n    document.addEventListener('astro:after-swap', () => {\n      analytics.track('page_view', { path: window.location.pathname });\n    });\n  </script>\n</html>`}</CodeBlock>
        </div>
        <P>
          Every page that extends this layout fires a{" "}
          <code className="font-mono text-text-primary">page_view</code> event. Break it
          down by path, build funnels, or compare cohorts — all from the same event shape.
        </P>
      </Step>

      <Step n={5} title="Track a custom event">
        <P>
          Import{" "}
          <code className="font-mono text-text-primary">analytics</code> in any component
          or island script block. Properties are plain values — no user IDs, no PII.
        </P>
        <div className="mt-3">
          <CodeBlock>{`<!-- src/components/UpgradeButton.astro -->\n<button id="upgrade-btn">Upgrade</button>\n\n<script>\n  import { analytics } from '../lib/analytics';\n\n  document.getElementById('upgrade-btn')!.addEventListener('click', () => {\n    analytics.track('upgrade_click', { plan: 'pro' });\n  });\n</script>`}</CodeBlock>
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
