import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, Step } from "../post-layout";

const meta = getPost("nuxt-analytics-in-5-minutes")!;

export const metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        <code className="font-mono text-text-primary">@counted/sdk</code> drops into a
        Nuxt 3 app as a single client-side plugin — no cookie banner, no 50KB bundle.
        Here&apos;s everything: runtime config, a plugin that auto-tracks every page view,
        and a custom event, in about five minutes.
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

      <Step n={3} title="Configure Nuxt runtime">
        <P>
          Declare the project key in{" "}
          <code className="font-mono text-text-primary">runtimeConfig.public</code>. Nuxt
          maps public runtime config to{" "}
          <code className="font-mono text-text-primary">NUXT_PUBLIC_*</code> env vars at
          runtime — no build-time bake-in, safe to change without a redeploy.
        </P>
        <div className="mt-3">
          <CodeBlock>{`// nuxt.config.ts\nexport default defineNuxtConfig({\n  runtimeConfig: {\n    public: {\n      countedProjectKey: '', // set via NUXT_PUBLIC_COUNTED_PROJECT_KEY\n    },\n  },\n})`}</CodeBlock>
        </div>
        <div className="mt-3">
          <CodeBlock>{`# .env\nNUXT_PUBLIC_COUNTED_PROJECT_KEY=ck_your_project_key`}</CodeBlock>
        </div>
      </Step>

      <Step n={4} title="Create the analytics plugin">
        <P>
          A file in{" "}
          <code className="font-mono text-text-primary">plugins/</code> with a{" "}
          <code className="font-mono text-text-primary">.client.ts</code> suffix runs only
          in the browser — no SSR guard needed. The plugin initialises the SDK once,
          auto-tracks every route change via{" "}
          <code className="font-mono text-text-primary">router.afterEach</code>, and
          makes the instance available everywhere via{" "}
          <code className="font-mono text-text-primary">provide</code>.
        </P>
        <div className="mt-3">
          <CodeBlock>{`// plugins/analytics.client.ts\nimport { Analytics } from '@counted/sdk';\n\nexport default defineNuxtPlugin(() => {\n  const config = useRuntimeConfig();\n  const analytics = new Analytics({\n    projectKey: config.public.countedProjectKey,\n  });\n\n  const router = useRouter();\n  router.afterEach((to) => {\n    analytics.track('page_view', { path: to.path });\n  });\n\n  return {\n    provide: { analytics },\n  };\n});`}</CodeBlock>
        </div>
        <P>
          Nuxt auto-discovers plugins in{" "}
          <code className="font-mono text-text-primary">plugins/</code> — no registration
          step needed.{" "}
          <code className="font-mono text-text-primary">afterEach</code> fires on the
          initial navigation and every client-side route change after that. Every page
          your users visit sends a{" "}
          <code className="font-mono text-text-primary">page_view</code> event.
        </P>
      </Step>

      <Step n={5} title="Track a custom event">
        <P>
          Access the analytics instance with{" "}
          <code className="font-mono text-text-primary">useNuxtApp()</code> in any
          component. Properties are plain values — no user IDs, no PII.
        </P>
        <div className="mt-3">
          <CodeBlock>{`<script setup lang="ts">\nconst { $analytics } = useNuxtApp();\n</script>\n\n<template>\n  <button @click="$analytics.track('upgrade_click', { plan: 'pro' })">\n    Upgrade\n  </button>\n</template>`}</CodeBlock>
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
