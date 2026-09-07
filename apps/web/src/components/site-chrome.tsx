import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@counted/ui/components/button";
import { consoleOrigin } from "../lib/env";
import { docsOrigin, siteOrigin } from "../lib/site";

export function SiteLinkButton({ href, children, variant = "default" }: { href: string; children: ReactNode; variant?: "default" | "outline" }) {
  return <Button nativeButton={false} render={<Link href={href} />} variant={variant}>{children}</Button>;
}
export function SiteChrome({ children }: { children: ReactNode }) {
  return <div className="site-shell min-h-dvh flex flex-col">
    <a href="#site-content" className="sr-only fixed left-4 top-4 z-50 bg-background p-3 focus:not-sr-only">Skip to content</a>
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-5 px-5 py-5 sm:px-8">
        <Link href={siteOrigin()} className="font-heading text-2xl tracking-tight" aria-label="Counted home">Counted<span className="text-primary">.</span></Link>
        <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
          <Link href="/pricing">Pricing</Link><Link href={docsOrigin()}>Docs</Link><Link href="/vs">Compare</Link><Link href="/blog">Blog</Link>
          <Link href={`${consoleOrigin()}/sign-in`} className="font-medium text-primary-ink">Sign in <span aria-hidden="true">↗</span></Link>
        </nav>
      </div>
    </header>
    <main id="site-content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-5 py-12 sm:px-8 sm:py-20">{children}</main>
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-8 text-xs text-muted-foreground sm:px-8 md:flex-row md:justify-between">
        <p>© {new Date().getFullYear()} Iceglobe Enterprises LLC</p>
        <nav aria-label="Footer navigation" className="flex flex-wrap gap-x-5 gap-y-3">
          <Link href="/about">About</Link><Link href="/contact">Contact</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/for/agents">For agents</Link><a href="https://github.com/iceglober/counted">GitHub</a><Link href="/llms.txt">llms.txt</Link>
        </nav>
      </div>
    </footer>
  </div>;
}
export function PageIntro({ eyebrow, title, children }: { eyebrow?: string | undefined; title: string; children?: ReactNode }) {
  return <header className="mb-10 max-w-3xl space-y-4 sm:mb-14">{eyebrow && <p className="text-xs font-medium uppercase tracking-widest text-primary-ink">{eyebrow}</p>}<h1 className="font-heading text-4xl leading-tight sm:text-5xl">{title}</h1>{children && <div className="text-base leading-relaxed text-muted-foreground">{children}</div>}</header>;
}
export function SiteArticle({ title, children, eyebrow }: { title: string; children: ReactNode; eyebrow?: string }) {
  return <article className="site-prose max-w-3xl"><PageIntro title={title} eyebrow={eyebrow}/>{children}</article>;
}
export function CodeBlock({ children }: { children: ReactNode }) {
  return <pre tabIndex={0} className="max-w-full whitespace-pre-wrap [overflow-wrap:anywhere] border bg-muted/30 p-5 text-xs leading-6 sm:text-sm"><code>{children}</code></pre>;
}
