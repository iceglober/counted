import Link from "next/link";
import { CountedLogo } from "@/components/icons";

const GITHUB = "https://github.com/iceglober/counted";

// Shared nav + footer for marketing sub-pages (comparisons, /for, blog).
// The home page keeps its own inline nav; these give every other marketing
// surface the same chrome without duplicating it per page.

export function SiteNav() {
  return (
    <nav className="flex items-center justify-between px-6 py-4 max-w-5xl mx-auto">
      <Link href="/" className="flex items-center gap-2">
        <CountedLogo className="w-5 h-5 text-accent" />
        <span className="font-display text-lg tracking-wide">Counted</span>
      </Link>
      <div className="flex items-center gap-6 text-sm">
        <Link href="/blog" className="text-text-secondary hover:text-text-primary transition-colors">Blog</Link>
        <Link href="/pricing" className="text-text-secondary hover:text-text-primary transition-colors">Pricing</Link>
        <a href={GITHUB} className="text-text-secondary hover:text-text-primary transition-colors">GitHub</a>
        <Link href="/login" className="text-accent hover:text-accent-hover transition-colors font-medium">Sign in</Link>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="px-6 py-8 border-t border-border mt-8">
      <div className="max-w-4xl mx-auto flex flex-col gap-4 text-xs text-text-tertiary">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CountedLogo className="w-3.5 h-3.5" />
            <span>Counted</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/blog" className="hover:text-text-secondary transition-colors">Blog</Link>
            <Link href="/pricing" className="hover:text-text-secondary transition-colors">Pricing</Link>
            <Link href="/vs/aptabase" className="hover:text-text-secondary transition-colors">Compare</Link>
            <a href={GITHUB} className="hover:text-text-secondary transition-colors">GitHub</a>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-text-tertiary/80">
          <span>No cookies. No fingerprinting. No PII.</span>
          <span className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-text-secondary transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-text-secondary transition-colors">Terms</Link>
            <span>© {new Date().getFullYear()} Iceglobe Enterprises LLC</span>
          </span>
        </div>
      </div>
    </footer>
  );
}

// Reusable building blocks matching the existing marketing style.

export function Eyebrow({ children }: { children: string }) {
  return <p className="text-xs font-medium tracking-[0.15em] uppercase text-accent">{children}</p>;
}

export function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="text-left bg-surface-1 border border-accent/30 rounded-xl px-5 py-4 text-xs md:text-sm font-mono text-text-secondary overflow-x-auto leading-relaxed whitespace-pre">
      {children}
    </pre>
  );
}

export function PrimaryCTA({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center px-6 py-3 bg-accent text-surface-0 rounded-md text-sm font-medium hover:bg-accent-hover active:translate-y-px transition-[background-color,transform] duration-150"
    >
      {children}
    </Link>
  );
}

export function SecondaryCTA({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center px-6 py-3 border border-border text-text-secondary rounded-md text-sm hover:border-border-hover hover:text-text-primary active:translate-y-px transition-[border-color,color,transform] duration-150"
    >
      {children}
    </Link>
  );
}
