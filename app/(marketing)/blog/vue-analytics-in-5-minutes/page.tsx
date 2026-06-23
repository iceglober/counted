import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, Step } from "../post-layout";

const meta = getPost("vue-analytics-in-5-minutes")!;

export const metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        <code className="font-mono text-text-primary">@counted/sdk</code> drops into any
        Vue 3 + Vite app in a single module — no cookie banner, no 50KB bundle.
        Here&apos;s the whole setup: one singleton, auto page-view tracking via{" "}
        <code className="font-mono text-text-primary">router.afterEach</code>, and a
        custom event, in about five minutes.
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
        <P>Client keys are write-only — safe to ship in the browser.</P>
      </Step>

      <Step n={2} title="Install the SDK">
        <div className="mt-1">
          <CodeBlock>{`npm install @counted/sdk`}</CodeBlock>
        </div>
      </Step>

      <Step n={3} title="Configure your project key">
        <P>
          Add the key to{" "}
          <code className="font-mono text-text-primary">.env</code>. Vite exposes any{" "}
          <code className="font-mono text-text-primary">VITE_*</code> variable to the
          browser via{" "}
          <code className="font-mono text-text-primary">import.meta.env</code> — baked in
          at build time, no server needed.
        </P>
        <div className="mt-3">
          <CodeBlock>{`# .env\nVITE_COUNTED_PROJECT_KEY=ck_your_project_key`}</CodeBlock>
        </div>
      </Step>

      <Step n={4} title="Create the analytics module and wire up page views">
        <P>
          Initialise the SDK once in a dedicated module, then register a{" "}
          <code className="font-mono text-text-primary">router.afterEach</code> hook that
          fires on every route change — including the initial navigation.
        </P>
        <div className="mt-3">
          <CodeBlock>{`// src/analytics.ts\nimport { Analytics } from '@counted/sdk';\n\nexport const analytics = new Analytics({\n  projectKey: import.meta.env.VITE_COUNTED_PROJECT_KEY as string,\n});`}</CodeBlock>
        </div>
        <div className="mt-3">
          <CodeBlock>{`// src/router/index.ts\nimport { createRouter, createWebHistory } from 'vue-router';\nimport { analytics } from '../analytics';\n\nconst router = createRouter({\n  history: createWebHistory(import.meta.env.BASE_URL),\n  routes: [\n    // your routes\n  ],\n});\n\nrouter.afterEach((to) => {\n  analytics.track('page_view', { path: to.path });\n});\n\nexport default router;`}</CodeBlock>
        </div>
        <P>
          Every page your users visit — on initial load and on every client-side
          navigation — sends a{" "}
          <code className="font-mono text-text-primary">page_view</code> event. No SSR
          guard needed; Vite apps run entirely in the browser.
        </P>
      </Step>

      <Step n={5} title="Track a custom event">
        <P>
          Import the singleton directly in any component. Properties are plain
          values — no user IDs, no PII.
        </P>
        <div className="mt-3">
          <CodeBlock>{`<script setup lang="ts">\nimport { analytics } from '../analytics';\n</script>\n\n<template>\n  <button @click="analytics.track('upgrade_click', { plan: 'pro' })">\n    Upgrade\n  </button>\n</template>`}</CodeBlock>
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
