import { SiteNav, SiteFooter } from "./site-chrome";

// Shared chrome + prose primitives for legal pages (privacy, terms), styled to
// match the marketing site's tokens.

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <SiteNav />
      <article className="px-6 pt-16 pb-12 max-w-2xl mx-auto">
        <h1 className="font-display text-[clamp(1.9rem,4.5vw,2.6rem)] tracking-tight leading-tight">{title}</h1>
        <p className="mt-3 text-text-tertiary text-sm">Last updated {updated}</p>
        <div className="mt-10">{children}</div>
      </article>
      <SiteFooter />
    </div>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 font-display text-xl md:text-2xl tracking-tight">{children}</h2>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 text-text-secondary leading-relaxed">{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mt-4 space-y-2 text-text-secondary leading-relaxed list-disc pl-5">{children}</ul>;
}
