import type { Metadata } from "next";
import { getPost } from "../posts";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, Step } from "../post-layout";

const meta = getPost("self-host-counted-in-5-minutes")!;

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
        Counted is open source, so you can run the whole thing on your own infrastructure — no
        data leaves your servers, no vendor in the loop. With Docker Compose it&apos;s a few
        commands. Here&apos;s the five-minute version.
      </Lead>

      <Step n={1} title="Clone and configure">
        <P>Grab the repo and copy the example environment file:</P>
        <div className="mt-3">
          <CodeBlock>{`git clone https://github.com/iceglober/counted.git
cd counted/self-host
cp .env.example .env`}</CodeBlock>
        </div>
        <P>Set a strong secret, your base URL, and a database password in <code className="font-mono text-text-primary">.env</code>:</P>
        <div className="mt-3">
          <CodeBlock>{`BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BASE_URL=https://analytics.yourcompany.com
POSTGRES_PASSWORD=a-strong-password`}</CodeBlock>
        </div>
      </Step>

      <Step n={2} title="Start it">
        <div className="mt-1">
          <CodeBlock>{`docker compose up -d`}</CodeBlock>
        </div>
        <P>Counted is now running at <code className="font-mono text-text-primary">http://localhost:3000</code> (Postgres + TimescaleDB and the app, all in the compose file).</P>
      </Step>

      <Step n={3} title="Create the hypertable (one time)">
        <P>On first start, enable TimescaleDB and turn the events table into a hypertable — a single one-time step:</P>
        <div className="mt-3">
          <CodeBlock>{`docker compose exec db psql -U counted -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"
docker compose exec db psql -U counted -c "SELECT create_hypertable('events', 'timestamp', if_not_exists => TRUE);"`}</CodeBlock>
        </div>
      </Step>

      <Step n={4} title="Sign in">
        <P>
          Open <code className="font-mono text-text-primary">/login</code> and enter your email. With Resend configured, the magic link
          arrives by email. Without it, grab the token straight from the database:
        </P>
        <div className="mt-3">
          <CodeBlock>{`docker compose exec db psql -U counted -c \\
  "SELECT identifier FROM verification ORDER BY created_at DESC LIMIT 1;"`}</CodeBlock>
        </div>
        <P>Then visit <code className="font-mono text-text-primary">/api/auth/magic-link/verify?token=&lt;TOKEN&gt;&amp;callbackURL=/dashboards</code>.</P>
      </Step>

      <Step n={5} title="Send your first event">
        <P>Create a project, copy its <code className="font-mono text-text-primary">ck_</code> key, and point any Counted SDK at your own host:</P>
        <div className="mt-3">
          <CodeBlock>{`import { Analytics } from "@counted/sdk";

const counted = new Analytics({
  projectKey: "ck_your_project_key",
  host: "https://analytics.yourcompany.com",
});

counted.track("app_started");`}</CodeBlock>
        </div>
        <P>Same SDKs, same dashboards — running entirely on your infrastructure. Set a strong secret and password, put it behind TLS, and you&apos;re production-ready.</P>
      </Step>
    </PostLayout>
  );
}
