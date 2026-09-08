"use client";

import { useState } from "react";
import {
  IconLayoutDashboard,
  IconFolders,
  IconHistory,
  IconMenu2,
} from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import { Badge } from "@counted/ui/components/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@counted/ui/components/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@counted/ui/components/sheet";

const pages = [
  { name: "Overview", icon: IconLayoutDashboard },
  { name: "Collections", icon: IconFolders },
  { name: "Activity", icon: IconHistory },
] as const;
const collections = [
  { name: "Website", detail: "Public-facing pages and resources", count: 12 },
  { name: "Application", detail: "The everyday working collection", count: 8 },
  { name: "Documentation", detail: "Guides, references, and notes", count: 4 },
];
const activity = [
  ["Application updated", "Two records added to the collection.", "Today"],
  ["Website reviewed", "All twelve records are up to date.", "Yesterday"],
  ["Documentation created", "A new home for guides and references.", "Sep 4"],
];

export default function SidebarShellExample() {
  const [page, setPage] = useState<string>("Overview");
  const [open, setOpen] = useState(false);
  function navigate(next: string) {
    setPage(next);
    setOpen(false);
  }
  const navigation = (
    <nav aria-label="Sidebar application" className="grid gap-1">
      {pages.map(({ name, icon: Icon }) => (
        <Button
          key={name}
          variant="ghost"
          className="h-11 w-full justify-start gap-3 px-3 aria-[current=page]:bg-accent aria-[current=page]:text-primary-ink"
          aria-current={page === name ? "page" : undefined}
          onClick={() => navigate(name)}
        >
          <Icon className="size-4" />
          {name}
        </Button>
      ))}
    </nav>
  );
  return (
    <div
      className="@container/shell w-full border bg-background text-sm"
      data-layout="sidebar-shell"
    >
      <div className="grid min-h-[540px] grid-cols-1 @min-[680px]/shell:grid-cols-[184px_minmax(0,1fr)]">
        <aside className="hidden min-w-0 flex-col border-r bg-muted/40 @min-[680px]/shell:flex">
          <div className="flex min-h-16 items-center border-b px-5 font-heading text-lg">
            counted
          </div>
          <div className="flex flex-1 flex-col gap-6 p-3">
            <p className="px-3 pt-3 text-xs text-muted-foreground">
              Acme workspace
            </p>
            {navigation}
            <p className="mt-auto border-t px-3 pt-4 text-xs leading-relaxed text-muted-foreground">
              A shared place for
              <br />
              your everyday work.
            </p>
          </div>
        </aside>
        <div className="flex min-w-0 flex-col">
          <header className="flex min-h-16 flex-wrap items-center gap-3 border-b px-5 @min-[680px]/shell:px-7">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    className="-ml-2 @min-[680px]/shell:hidden"
                  />
                }
                aria-label="Open application navigation"
              >
                <IconMenu2 />
              </SheetTrigger>
              <SheetContent side="left" className="max-w-80">
                <SheetHeader className="px-6 pr-14">
                  <SheetTitle>Acme workspace</SheetTitle>
                  <SheetDescription>Choose a page.</SheetDescription>
                </SheetHeader>
                <div className="px-3">{navigation}</div>
              </SheetContent>
            </Sheet>
            <span className="text-muted-foreground">
              Acme{" "}
              <span aria-hidden="true" className="px-2 text-border">
                /
              </span>{" "}
              <span className="text-foreground">{page}</span>
            </span>
          </header>
          <section
            aria-label={`${page} page`}
            className="flex-1 p-5 @min-[680px]/shell:p-7"
          >
            <div className="mb-7">
              <p className="mb-2 text-xs text-muted-foreground">Workspace</p>
              <h3 className="font-heading text-xl">{page}</h3>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
                {page === "Overview"
                  ? "A little context before you get to work."
                  : page === "Collections"
                    ? "Everything has a place. Find the collection you need."
                    : "The latest changes, in one place."}
              </p>
            </div>
            {page === "Overview" && (
              <div className="mb-7 grid grid-cols-2 gap-3">
                {[
                  ["Collections", "3"],
                  ["Records", "24"],
                ].map(([label, value]) => (
                  <Card size="sm" key={label}>
                    <CardHeader>
                      <CardTitle className="text-xs font-sans text-muted-foreground">
                        {label}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="font-heading text-2xl tabular-nums">
                        {value}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {page === "Activity" ? (
              <ol className="divide-y border-y">
                {activity.map(([title, description, date]) => (
                  <li
                    key={title}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-4"
                  >
                    <div>
                      <p className="font-medium">{title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {description}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {date}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-medium">
                    {page === "Overview"
                      ? "Your collections"
                      : "All collections"}
                  </h4>
                  <Badge variant="outline">3 collections</Badge>
                </div>
                <ul className="divide-y border-y">
                  {collections.map((item) => (
                    <li
                      key={item.name}
                      className="flex items-start justify-between gap-4 py-4"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">{item.name}</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {item.detail}
                        </p>
                      </div>
                      <span className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                        {item.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
          <footer className="flex flex-wrap justify-between gap-2 border-t px-5 py-3 text-xs text-muted-foreground @min-[680px]/shell:px-7">
            <span>Acme workspace</span>
            <span>All changes saved</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
