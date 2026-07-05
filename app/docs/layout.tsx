import Link from "next/link";
import { CountedLogo } from "@/components/icons";
import { DocsSidebar } from "@/components/docs/docs-sidebar";

// Docs shell — its own slim header + left sidebar, deliberately not the marketing
// nav/footer, so /docs reads like documentation rather than a landing page.
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[#999] bg-surface-0">
        <div className="flex items-center justify-between px-4 py-2 max-w-5xl mx-auto text-[12px]">
          <div className="flex items-baseline gap-2">
            <b className="text-[14px]">
              <Link href="/" className="inline-flex items-center gap-1.5">
                <CountedLogo className="w-4 h-4 text-accent" />
                Counted
              </Link>
            </b>
            <span>/</span>
            <Link href="/docs">Docs</Link>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/pricing" className="hidden sm:block">Pricing</Link>
            <span className="hidden sm:block">|</span>
            <a href="https://github.com/iceglober/counted" target="_blank" rel="noopener" className="ext">GitHub</a>
            <span>|</span>
            <a href="/login" target="_blank" rel="noopener" className="ext">Dashboard</a>
          </div>
        </div>
      </header>

      <div className="flex max-w-5xl mx-auto">
        <aside className="hidden md:block w-52 shrink-0 border-r border-[#ccc]">
          <div className="sticky top-10 max-h-[calc(100vh-2.5rem)] overflow-y-auto px-4 py-6">
            <DocsSidebar />
          </div>
        </aside>
        <main className="flex-1 min-w-0">
          <div className="page" style={{ margin: 0 }}>{children}</div>
        </main>
      </div>
    </div>
  );
}
