import { Sidebar, type Section } from "./nav";
import type { ContractOutputs } from "../lib/client";
export const Shell = ({
  me,
  workspaceId,
  section,
  children,
}: {
  me: ContractOutputs["account"]["me"];
  workspaceId: string;
  section: Section;
  children: React.ReactNode;
}) => (
  <div className="min-h-dvh lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
    <a
      href="#app-content"
      className="sr-only z-50 bg-background px-4 py-3 text-primary-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:outline-2 focus:outline-ring"
    >
      Skip to content
    </a>
    <Sidebar
      workspaces={me.workspaces}
      workspaceId={workspaceId}
      section={section}
      email={me.account.email}
    />
    <div className="min-w-0">
      <main
        id="app-content"
        tabIndex={-1}
        className="app-content mx-auto w-full max-w-[1320px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10"
      >
        {children}
        <footer className="mt-16 flex flex-wrap justify-between gap-3 border-t pt-5 text-xs text-muted-foreground">
          <span>Counted</span>
          <a
            href={`/w/${workspaceId}/api-explorer`}
            className="text-primary-ink underline underline-offset-4"
          >
            Explore the API
          </a>
        </footer>
      </main>
    </div>
  </div>
);
