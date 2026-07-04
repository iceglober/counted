import Link from "next/link";

const GITHUB = "https://github.com/iceglober/counted";

// Shared nav + footer for every marketing surface (home, pricing, comparisons,
// /for, blog) — plain text links, pipe-separated, in the .retro style.

export function SiteNav() {
  return (
    <div className="page">
      <nav className="sitenav">
        <b>
          <Link href="/">Counted</Link>
        </b>{" "}
        &middot; privacy-first product analytics
        <br />
        <Link href="/docs">Docs</Link> | <Link href="/pricing">Pricing</Link> |{" "}
        <Link href="/vs">Compare</Link> | <Link href="/blog">Blog</Link> |{" "}
        <a href={GITHUB}>GitHub</a> | <Link href="/login">Sign in</Link>
      </nav>
    </div>
  );
}

export function SiteFooter() {
  return (
    <div className="page">
      <footer className="sitefooter">
        <p>
          <Link href="/docs">Docs</Link> | <Link href="/blog">Blog</Link> |{" "}
          <Link href="/pricing">Pricing</Link> | <Link href="/vs">Compare</Link> |{" "}
          <Link href="/for/agents">For agents</Link> | <a href={GITHUB}>GitHub</a> |{" "}
          <Link href="/privacy">Privacy</Link> | <Link href="/terms">Terms</Link>
        </p>
        <p>
          No cookies. No fingerprinting. No PII. &copy; {new Date().getFullYear()} Iceglobe
          Enterprises LLC
        </p>
      </footer>
    </div>
  );
}

// Reusable building blocks. Kept API-compatible with the previous chrome so
// pages and /docs don't need import changes.

export function Eyebrow({ children }: { children: string }) {
  return <p className="small muted" style={{ textTransform: "uppercase" }}>{children}</p>;
}

export function CodeBlock({ children }: { children: React.ReactNode }) {
  // Plain classes so /docs (dark theme) still renders acceptably; inside
  // .retro the element styles take over.
  return (
    <pre className="text-left text-xs md:text-sm font-mono overflow-x-auto whitespace-pre bg-surface-1 border border-border px-4 py-3 leading-relaxed">
      {children}
    </pre>
  );
}

export function PrimaryCTA({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="btn">
      {children}
    </Link>
  );
}

export function SecondaryCTA({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href}>{children}</Link>;
}
