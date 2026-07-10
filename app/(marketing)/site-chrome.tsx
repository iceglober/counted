import Link from "next/link";
import { CountedLogo } from "@/components/icons";

const GITHUB = "https://github.com/iceglober/counted";

// A link that opens in a new tab, marked with the little ↗ (via .ext in CSS).
export function NewTabLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener" className="ext">
      {children}
    </a>
  );
}

// Shared nav + footer for every marketing surface (home, pricing, comparisons,
// /for, blog) — plain text links, pipe-separated, in the .retro style.

export function SiteNav() {
  return (
    <div className="page">
      <nav className="sitenav">
        <b>
          <Link href="/" className="inline-flex items-baseline gap-1.5">
            <CountedLogo className="w-3.5 h-3.5 self-center text-accent" />
            Counted
          </Link>
        </b>{" "}
        &middot; privacy-first product analytics
        <br />
        <NewTabLink href="/docs">Docs</NewTabLink> | <Link href="/pricing">Pricing</Link> |{" "}
        <Link href="/vs">Compare</Link> | <Link href="/blog">Blog</Link> |{" "}
        <NewTabLink href={GITHUB}>GitHub</NewTabLink> |{" "}
        <NewTabLink href="/login">Sign in</NewTabLink>
      </nav>
    </div>
  );
}

export function SiteFooter() {
  return (
    <div className="page">
      <footer className="sitefooter">
        <p>
          <NewTabLink href="/docs">Docs</NewTabLink> | <Link href="/blog">Blog</Link> |{" "}
          <Link href="/pricing">Pricing</Link> | <Link href="/vs">Compare</Link> |{" "}
          <Link href="/for/agents">For agents</Link> |{" "}
          <NewTabLink href={GITHUB}>GitHub</NewTabLink> |{" "}
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
