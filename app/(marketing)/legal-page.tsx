import { SiteNav, SiteFooter } from "./site-chrome";

// Shared chrome + prose primitives for legal pages (privacy, terms).

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
    <div>
      <SiteNav />
      <div className="page">
        <article>
          <h1>{title}</h1>
          <p className="small muted">Last updated {updated}</p>
          {children}
        </article>
      </div>
      <SiteFooter />
    </div>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2>{children}</h2>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul>{children}</ul>;
}
