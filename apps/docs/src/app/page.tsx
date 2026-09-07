import { Reference } from "../components/reference";
import { SiteHeader } from "../components/site-header";
export default function DocsHome() {
  return (
    <>
      <a
        href="#api-reference"
        className="sr-only fixed left-3 top-3 z-50 bg-background p-3 text-primary-ink focus:not-sr-only"
      >
        Skip to API reference
      </a>
      <SiteHeader />
      <main id="api-reference" tabIndex={-1}>
        <Reference />
      </main>
    </>
  );
}
