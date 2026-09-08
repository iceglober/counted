"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "cn";
import { IconArrowUpRight, IconMenu2, IconSearch } from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@counted/ui/components/input-group";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@counted/ui/components/sheet";
import { Toaster } from "@counted/ui/components/toast";
import { TooltipProvider } from "@counted/ui/components/tooltip";
import { aggregates, foundations, primitiveGroups } from "./catalog";

function LibraryIndex({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const isPrimitive = pathname.includes("/primitives");
  const isAggregate = pathname.includes("/aggregates");
  const groups = isPrimitive
    ? primitiveGroups.map((g) => ({
        name: g.name,
        items: g.items.map(
          ([id, title]) => ["/design/primitives/" + id, title] as const,
        ),
      }))
    : [
        {
          name: isAggregate ? "Compositions" : "Foundations",
          items: isAggregate
            ? aggregates.map(
                (a) =>
                  [
                    "/design/aggregates#agg-" + a.id + "-page",
                    a.title,
                  ] as const,
              )
            : foundations.map(
                ([id, title]) => ["/design#" + id, title] as const,
              ),
        },
      ];
  return (
    <div className="library-index">
      <div className="index-caption">Explore the library</div>
      {isPrimitive && (
        <InputGroup className="mb-6">
          <InputGroupInput
            aria-label="Find a primitive"
            placeholder="Find a primitive…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <InputGroupAddon>
            <IconSearch />
          </InputGroupAddon>
        </InputGroup>
      )}
      <nav aria-label="Library index" className="flex flex-col gap-6">
        {groups.map((group) => {
          const items = group.items.filter(([, title]) =>
            title.toLowerCase().includes(query.toLowerCase()),
          );
          return items.length ? (
            <div key={group.name} className="flex flex-col gap-1">
              <span className="index-group">{group.name}</span>
              {items.map(([href, title]) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => onNavigate?.()}
                  aria-current={pathname === href ? "page" : undefined}
                  className="index-link"
                >
                  {title}
                </Link>
              ))}
            </div>
          ) : null;
        })}
        {query &&
          !groups.some((g) =>
            g.items.some(([, title]) =>
              title.toLowerCase().includes(query.toLowerCase()),
            ),
          ) && (
            <p className="text-sm text-muted-foreground">
              No primitives match “{query}”.
            </p>
          )}
      </nav>
      <div className="index-note">
        <span className="block text-foreground">Built to compose.</span>Every
        example uses the same shared primitives.
      </div>
    </div>
  );
}

export function ShowcaseShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = pathname.includes("/primitives")
    ? "primitives"
    : pathname.includes("/aggregates")
      ? "aggregates"
      : "system";
  return (
    <TooltipProvider>
      <Toaster>
        <div data-counted-showcase className="showcase">
          <a href="#showcase-content" className="skip-link">
            Skip to content
          </a>
          <header className="showcase-header">
            <div className="header-inner">
              <Link
                href="/design"
                className="brand"
                aria-label="Counted UI home"
              >
                <span>
                  counted<span className="brand-ui">/ ui</span>
                </span>
              </Link>
              <span className="header-edition">Component library</span>
              <div className="ml-auto flex items-center gap-1">
                <a
                  href="https://ui.shadcn.com/create?preset=b7qmDPHCIC"
                  target="_blank"
                  rel="noreferrer"
                  className="preset-link"
                >
                  Sera foundation <IconArrowUpRight className="size-3.5" />
                </a>
                <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                  <SheetTrigger
                    render={
                      <Button
                        className="mobile-menu"
                        variant="ghost"
                        size="icon"
                        aria-label="Open library index"
                      />
                    }
                  >
                    <IconMenu2 />
                  </SheetTrigger>
                  <SheetContent
                    data-counted-showcase
                    side="left"
                    className="w-80 max-w-[calc(100%-2rem)] overflow-y-auto"
                  >
                    <SheetHeader>
                      <SheetTitle>Library index</SheetTitle>
                    </SheetHeader>
                    <LibraryIndex onNavigate={() => setMenuOpen(false)} />
                  </SheetContent>
                </Sheet>
              </div>
            </div>
            <nav className="category-nav" aria-label="Showcase categories">
              {[
                ["system", "/design", "Design system", "01"],
                ["primitives", "/design/primitives", "Primitives", "02"],
                [
                  "aggregates",
                  "/design/aggregates",
                  "Primitive aggregates",
                  "03",
                ],
              ].map(([id, href, label, number]) => (
                <Link
                  key={id}
                  href={href!}
                  aria-current={current === id ? "page" : undefined}
                  className={cn("category-link", current === id && "active")}
                >
                  <span className="category-number">{number}</span>
                  {label}
                </Link>
              ))}
            </nav>
          </header>
          <div className="showcase-layout">
            <aside className="desktop-index">
              <LibraryIndex />
            </aside>
            <main id="showcase-content" className="showcase-content">
              {children}
              <footer className="showcase-footer">
                <span>Counted UI</span>
                <span>Plain Charter / shadcn</span>
                <a
                  href="https://ui.shadcn.com/docs"
                  target="_blank"
                  rel="noreferrer"
                >
                  Built with shadcn/ui ↗
                </a>
              </footer>
            </main>
          </div>
        </div>
      </Toaster>
    </TooltipProvider>
  );
}
