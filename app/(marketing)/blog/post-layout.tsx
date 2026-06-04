import { notFound } from "next/navigation";
import Link from "next/link";
import { SiteNav, SiteFooter } from "../site-chrome";
import { TrackedCTA } from "../track";
import { JsonLd, blogPostingLd } from "@/components/json-ld";
import { PREVIEW, isLive, type PostMeta } from "./posts";

// Shared chrome + prose primitives for blog posts, styled to match the
// marketing site's tokens (font-display headings, text-secondary body).

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
    <div className="min-h-screen">
      {live && <JsonLd data={blogPostingLd(meta)} />}
      {!live && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-2 text-center text-xs text-amber-400">
          {meta.published
            ? `Scheduled preview — goes live ${formatDate(meta.date)}.`
            : "Draft preview — not published."}
        </div>
      )}
      <SiteNav />

      <article className="px-6 pt-16 pb-12 max-w-2xl mx-auto">
        <Link href="/blog" className="text-xs text-text-tertiary hover:text-text-secondary transition-colors">
          ← All posts
        </Link>
        <header className="mt-6">
          <p className="text-xs font-medium tracking-[0.15em] uppercase text-accent">{meta.category}</p>
          <h1 className="mt-3 font-display text-[clamp(1.9rem,4.5vw,2.6rem)] tracking-tight leading-tight">
            {meta.title}
          </h1>
          <p className="mt-4 text-text-tertiary text-sm">
            {formatDate(meta.date)} · {meta.readingTime} read
          </p>
        </header>

        <div className="mt-10">{children}</div>

        <div className="mt-12 pt-8 border-t border-border text-center">
          <p className="text-text-secondary">Start free — 100K events/month, no credit card.</p>
          <div className="mt-5">
            <TrackedCTA href="/login" location={`blog:${meta.slug}`} label="create_project">Create a project</TrackedCTA>
          </div>
        </div>
      </article>

      <SiteFooter />
    </div>
  );
}

export function Lead({ children }: { children: React.ReactNode }) {
  return <p className="text-lg text-text-secondary leading-relaxed">{children}</p>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-5 text-text-secondary leading-relaxed">{children}</p>;
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 font-display text-xl md:text-2xl tracking-tight">{children}</h2>;
}

export function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <h2 className="font-display text-lg md:text-xl tracking-tight flex items-baseline gap-3">
        <span className="text-accent text-sm font-mono">{String(n).padStart(2, "0")}</span>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}
