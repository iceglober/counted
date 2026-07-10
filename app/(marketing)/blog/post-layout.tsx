import { notFound } from "next/navigation";
import Link from "next/link";
import { SiteNav, SiteFooter } from "../site-chrome";
import { TrackedCTA } from "../track";
import { JsonLd, blogPostingLd } from "@/components/json-ld";
import { PREVIEW, isLive, type PostMeta } from "./posts";

// Shared chrome + prose primitives for blog posts, in the plain .retro style.

function formatDate(iso: string): string {
  // Avoid locale/timezone surprises in SSR — format the yyyy-mm-dd directly.
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m, d] = iso.split("-").map(Number);
  return `${months[m - 1]} ${d}, ${y}`;
}

export function PostLayout({ meta, children }: { meta: PostMeta; children: React.ReactNode }) {
  const live = isLive(meta);
  // Not-yet-live posts (unpublished or scheduled for a future date) 404 in
  // production, but render in preview (dev / SHOW_DRAFTS) so they can be reviewed.
  if (!live && !PREVIEW) notFound();

  return (
    <div>
      {live && <JsonLd data={blogPostingLd(meta)} />}
      <SiteNav />

      <div className="page">
        {!live && (
          <div className="note">
            {meta.published
              ? `Scheduled preview — goes live ${formatDate(meta.date)}.`
              : "Draft preview — not published."}
          </div>
        )}

        <p className="small">
          <Link href="/blog">&laquo; All posts</Link>
        </p>

        <article>
          <h1>{meta.title}</h1>
          <p className="small muted">
            {formatDate(meta.date)} &middot; {meta.readingTime} read &middot; {meta.category}
          </p>

          {children}

          <hr />
          <p>
            Start free — 100K events/month, no credit card.{" "}
            <TrackedCTA href="/login" location={`blog:${meta.slug}`} label="create_project">
              Create a project
            </TrackedCTA>
          </p>
        </article>
      </div>

      <SiteFooter />
    </div>
  );
}

export function Lead({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2>{children}</h2>;
}

export function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2>
        {n}. {title}
      </h2>
      {children}
    </div>
  );
}
