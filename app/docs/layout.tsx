import Link from "next/link";
import { CountedLogo } from "@/components/icons";
import { DocsSidebar } from "@/components/docs/docs-sidebar";

// Docs shell — its own slim header + left sidebar, deliberately not the marketing
// nav/footer, so /docs reads like documentation rather than a landing page.
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-surface-0/80 backdrop-blur">
        <div className="flex items-center justify-between px-6 h-14 max-w-7xl mx-auto">
          <div className="flex items-center gap-2.5">
            <Link href="/" className="flex items-center gap-2">
              <CountedLogo className="w-5 h-5 text-accent" />
              <span className="font-display text-lg tracking-wide">Counted</span>
            </Link>
            <span className="text-text-tertiary">/</span>
            <Link href="/docs" className="text-sm text-text-secondary hover:text-text-primary transition-colors">Docs</Link>
          </div>
          <div className="flex items-center gap-5 text-sm">
            <Link href="/pricing" className="hidden sm:block text-text-secondary hover:text-text-primary transition-colors">Pricing</Link>
            <a href="https://github.com/iceglober/counted" className="text-text-secondary hover:text-text-primary transition-colors">GitHub</a>
            <Link href="/login" className="text-accent hover:text-accent-hover transition-colors font-medium">Dashboard</Link>
          </div>
        </div>
      </header>

      <div className="flex max-w-7xl mx-auto">
        <aside className="hidden md:block w-60 shrink-0 border-r border-border">
          <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto px-4 py-8">
            <DocsSidebar />
          </div>
        </aside>
        <main className="flex-1 min-w-0 px-6 py-10 md:px-10">
          <div className="max-w-3xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
