import Link from "next/link";
import { CountedLogo } from "@/components/icons";

/**
 * Navigation for the signed-in console.
 *
 * There was none. Marketing has `site-chrome.tsx`; the console rendered a bare
 * `<main>` and nothing else, so signing in landed you on a project page with no
 * link to dashboards, no link to settings, and no way to sign out. The app was
 * navigable only by typing URLs, which reads — correctly — as broken.
 *
 * Same vocabulary as the marketing nav: pipe-separated text links in the plain
 * style, not a second design language for the half of the product people
 * actually spend time in.
 *
 * Deliberately not showing a workspace switcher. An account can belong to
 * several and the workspace travels in the URL rather than in remembered
 * state; a switcher here would be a fourth place that can disagree with the
 * other three. It belongs on the pages that already know which workspace they
 * are about.
 */
export function ConsoleNav() {
  return (
    // Wrapped in `.page` for the same reason the marketing nav is: `.sitenav`
    // supplies the rule and the type size, and the column comes from outside
    // it. Without this the nav runs the full width while the content below
    // does not.
    <div className="page">
      <nav className="sitenav">
        <b>
          <Link href="/dashboards">
            <CountedLogo className="w-3.5 h-3.5" /> Counted
          </Link>
        </b>
        <br />
        <Link href="/dashboards">Dashboards</Link> | <Link href="/projects">Projects</Link> |{" "}
        <Link href="/settings">Settings</Link> | <Link href="/docs">Docs</Link> |{" "}
        <Link href="/sign-out">Sign out</Link>
      </nav>
    </div>
  );
}

/**
 * Wraps a console page in the nav and the reading column.
 *
 * Each console section imports this from its own `layout.tsx` rather than the
 * routes being moved into a `(console)` group — the same result without
 * relocating live URLs, which is not a change to make the day before a launch.
 */
export function ConsoleShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ConsoleNav />
      {children}
    </>
  );
}
