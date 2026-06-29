import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, Step } from "../post-layout";

const meta = getPost("react-vite-analytics-in-5-minutes")!;

export const metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        <code className="font-mono text-text-primary">@counted/react</code> drops into any
        Vite React app without a cookie banner or a 50KB script. Here&apos;s the whole
        thing — a provider in <code className="font-mono text-text-primary">main.tsx</code>,
        auto page views on every route, and a custom event — in about five minutes.
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
          <code className="font-mono text-text-primary">.env</code>. Vite exposes{" "}
          <code className="font-mono text-text-primary">VITE_</code>-prefixed variables to
          the browser bundle via{" "}
          <code className="font-mono text-text-primary">import.meta.env</code>:
        </P>
        <div className="mt-3">
          <CodeBlock>{`# .env\nVITE_COUNTED_PROJECT_KEY=ck_your_project_key`}</CodeBlock>
        </div>
        <P>Client keys are write-only — safe to ship in the browser.</P>
      </Step>

      <Step n={2} title="Install the SDK">
        <P>
          Install{" "}
          <code className="font-mono text-text-primary">@counted/react</code>. If you
          haven&apos;t added routing yet,{" "}
          <code className="font-mono text-text-primary">react-router-dom</code> is needed
          for automatic page-view tracking in Step 4:
        </P>
        <div className="mt-1">
          <CodeBlock>{`npm install @counted/react react-router-dom`}</CodeBlock>
        </div>
      </Step>

      <Step n={3} title="Add the provider to main.tsx">
        <P>
          Wrap your app with{" "}
          <code className="font-mono text-text-primary">AnalyticsProvider</code> inside{" "}
          <code className="font-mono text-text-primary">BrowserRouter</code> in{" "}
          <code className="font-mono text-text-primary">src/main.tsx</code>. Every
          component in your tree can now call{" "}
          <code className="font-mono text-text-primary">useAnalytics()</code>.
        </P>
        <div className="mt-3">
          <CodeBlock>{`// src/main.tsx\nimport { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport { BrowserRouter } from "react-router-dom";\nimport { AnalyticsProvider } from "@counted/react";\nimport App from "./App";\n\ncreateRoot(document.getElementById("root")!).render(\n  <StrictMode>\n    <BrowserRouter>\n      <AnalyticsProvider\n        projectKey={import.meta.env.VITE_COUNTED_PROJECT_KEY}\n        host="https://app.counted.dev"\n      >\n        <App />\n      </AnalyticsProvider>\n    </BrowserRouter>\n  </StrictMode>\n);`}</CodeBlock>
        </div>
      </Step>

      <Step n={4} title="Auto-track page views">
        <P>
          Create a small component that fires a{" "}
          <code className="font-mono text-text-primary">page_view</code> event whenever
          the route changes.{" "}
          <code className="font-mono text-text-primary">useLocation()</code> updates on
          every client-side navigation, so one component covers your whole app:
        </P>
        <div className="mt-3">
          <CodeBlock>{`// src/components/PageViews.tsx\nimport { useEffect } from "react";\nimport { useLocation } from "react-router-dom";\nimport { useAnalytics } from "@counted/react";\n\nexport function PageViews() {\n  const { track } = useAnalytics();\n  const { pathname } = useLocation();\n  useEffect(() => {\n    track("page_view", { path: pathname });\n  }, [pathname, track]);\n  return null;\n}`}</CodeBlock>
        </div>
        <P>
          Render it at the top of{" "}
          <code className="font-mono text-text-primary">App.tsx</code>, alongside your
          routes:
        </P>
        <div className="mt-3">
          <CodeBlock>{`// src/App.tsx\nimport { Routes, Route } from "react-router-dom";\nimport { PageViews } from "./components/PageViews";\n\nexport default function App() {\n  return (\n    <>\n      <PageViews />\n      <Routes>\n        <Route path="/" element={<Home />} />\n        <Route path="/pricing" element={<Pricing />} />\n      </Routes>\n    </>\n  );\n}`}</CodeBlock>
        </div>
        <P>
          Every page your users visit now appears in the dashboard as a{" "}
          <code className="font-mono text-text-primary">page_view</code> event. Build
          funnels, breakdowns by path, or retention curves — all from the same event shape.
        </P>
      </Step>

      <Step n={5} title="Track a custom event">
        <P>
          Call{" "}
          <code className="font-mono text-text-primary">useAnalytics()</code> in any
          component inside the provider. Properties are plain values — no user IDs, no PII.
        </P>
        <div className="mt-3">
          <CodeBlock>{`// src/components/UpgradeButton.tsx\nimport { useAnalytics } from "@counted/react";\n\nexport function UpgradeButton() {\n  const { track } = useAnalytics();\n  return (\n    <button onClick={() => track("upgrade_click", { plan: "pro" })}>\n      Upgrade\n    </button>\n  );\n}`}</CodeBlock>
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
