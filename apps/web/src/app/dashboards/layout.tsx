import { ConsoleShell } from "@/components/console-chrome";

/**
 * Console chrome for /dashboards.
 *
 * A thin layout per section rather than moving these routes into a
 * `(console)` group: the same result without relocating live URLs, which is
 * not a change worth making the day before a launch. If a fifth section
 * appears, it needs one of these too — `console-chrome.test.ts` checks that.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
