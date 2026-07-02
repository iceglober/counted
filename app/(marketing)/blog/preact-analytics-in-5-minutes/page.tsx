import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, Step } from "../post-layout";

const meta = getPost("preact-analytics-in-5-minutes")!;

export const metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        <code className="font-mono text-text-primary">@counted/sdk</code> drops
        into any Preact app in a handful of lines — no cookie banner, no consent
        wall, no 50KB bundle. Here's the whole setup: a singleton, auto page
        views on every route, and a custom event, in about five minutes.
      </Lead>

      <Step n={1} title="Get a project key">
        <P>
          Create a project and copy its <strong>client key</strong> (starts with{" "}
          <code className="font-mono text-text-primary">ck_</code>) — or mint one
          with no signup:
        </P>
        <div className="mt-3">
          <CodeBlock>{`curl -X POST https://app.counted.dev/api/v0/provision`}</CodeBlock>
        </div>
        <P>
          Add it to your{" "}
          <code className="font-mono text-text-primary">.env</code>. Preact's
          default Vite template exposes{" "}
          <code className="font-mono text-text-primary">VITE_</code>-prefixed
          vars to the browser bundle:
        </P>
        <div className="mt-3">
          <CodeBlock>{`# .env\nVITE_COUNTED_PROJECT_KEY=ck_your_project_key`}</CodeBlock>
        </div>
        <P>Client keys are write-only — safe to ship in the browser.</P>
      </Step>

      <Step n={2} title="Install the SDK">
        <div className="mt-1">
          <CodeBlock>{`npm install @counted/sdk`}</CodeBlock>
        </div>
      </Step>

      <Step n={3} title="Create an analytics module">
        <P>
          Create a singleton at{" "}
          <code className="font-mono text-text-primary">src/analytics.ts</code>.
          Import it anywhere in your app — no context or provider needed.
        </P>
        <div className="mt-3">
          <CodeBlock>{`// src/analytics.ts\nimport { Analytics } from "@counted/sdk";\n\nexport const analytics = new Analytics({\n  projectKey: import.meta.env.VITE_COUNTED_PROJECT_KEY,\n  host: "https://app.counted.dev",\n});`}</CodeBlock>
        </div>
      </Step>

      <Step n={4} title="Auto-track page views">
        <P>
          Create a small component that fires a{" "}
          <code className="font-mono text-text-primary">page_view</code> event
          whenever the route changes.{" "}
          <code className="font-mono text-text-primary">preact-iso</code>'s{" "}
          <code className="font-mono text-text-primary">useLocation()</code>{" "}
          returns a reactive location object — its{" "}
          <code className="font-mono text-text-primary">url</code> field updates
          on every client-side navigation.
        </P>
        <div className="mt-3">
          <CodeBlock>{`// src/components/PageViews.tsx\nimport { useEffect } from "preact/hooks";\nimport { useLocation } from "preact-iso";\nimport { analytics } from "../analytics";\n\nexport function PageViews() {\n  const { url } = useLocation();\n  useEffect(() => {\n    analytics.track("page_view", { path: url });\n  }, [url]);\n  return null;\n}`}</CodeBlock>
        </div>
        <P>
          Render it once inside your root{" "}
          <code className="font-mono text-text-primary">
            {"<LocationProvider>"}
          </code>{" "}
          in{" "}
          <code className="font-mono text-text-primary">src/index.tsx</code>:
        </P>
        <div className="mt-3">
          <CodeBlock>{`// src/index.tsx\nimport { LocationProvider, Router, Route } from "preact-iso";\nimport { PageViews } from "./components/PageViews";\nimport { Home } from "./pages/Home";\n\nexport function App() {\n  return (\n    <LocationProvider>\n      <PageViews />\n      <Router>\n        <Route path="/" component={Home} />\n      </Router>\n    </LocationProvider>\n  );\n}`}</CodeBlock>
        </div>
        <P>
          Every page your users visit now appears in the dashboard as a{" "}
          <code className="font-mono text-text-primary">page_view</code> event.
          Break it down by path, build funnels, or compare cohorts — all from
          the same event shape.
        </P>
      </Step>

      <Step n={5} title="Track a custom event">
        <P>
          Import the singleton in any component and call{" "}
          <code className="font-mono text-text-primary">track()</code>.
          Properties are plain values — no user IDs, no PII.
        </P>
        <div className="mt-3">
          <CodeBlock>{`// src/components/UpgradeButton.tsx\nimport { analytics } from "../analytics";\n\nexport function UpgradeButton() {\n  return (\n    <button onClick={() => analytics.track("upgrade_click", { plan: "pro" })}>\n      Upgrade\n    </button>\n  );\n}`}</CodeBlock>
        </div>
        <P>
          Your event shows up on the dashboard within a second or two. Add as
          many properties as you want — breakdowns, time series, and funnels
          compose from whatever shape you send.
        </P>
      </Step>
    </PostLayout>
  );
}
