import { Button } from "@counted/ui/components/button";
import { publicUrls } from "../lib/deployment";
export function SiteHeader() {
  const urls = publicUrls();
  return (
    <header className="docs-header flex min-h-18 flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b px-5 py-4 sm:px-8">
      <a href="/" className="flex items-baseline gap-3">
        <span className="font-heading text-2xl">counted</span>
        <span className="text-sm text-muted-foreground">Documentation</span>
      </a>
      <nav
        aria-label="Documentation"
        className="flex flex-wrap items-center gap-3 sm:gap-5"
      >
        <a
          href="/getting-started"
          className="text-xs text-primary-ink underline underline-offset-4"
        >
          Get started
        </a>
        <a
          href="/"
          className="text-xs text-primary-ink underline underline-offset-4"
        >
          API reference
        </a>
        <a
          href="/openapi.json"
          download="counted-openapi.json"
          className="text-xs text-primary-ink underline underline-offset-4"
        >
          OpenAPI JSON
        </a>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<a href={`${urls.console}/api-explorer`} />}
        >
          Open API Explorer
        </Button>
      </nav>
    </header>
  );
}
