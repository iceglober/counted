"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV: { title: string; items: { label: string; href: string }[] }[] = [
  {
    title: "Getting started",
    items: [
      { label: "Overview", href: "/docs" },
      { label: "Quickstart", href: "/docs#quickstart" },
    ],
  },
  {
    title: "API reference",
    items: [
      { label: "Overview", href: "/docs/api" },
      { label: "Ingestion", href: "/docs/api#tag-Ingestion" },
      { label: "Projects", href: "/docs/api#tag-Projects" },
      { label: "Query", href: "/docs/api#tag-Query" },
      { label: "Dashboards", href: "/docs/api#tag-Dashboards" },
      { label: "Alerts", href: "/docs/api#tag-Alerts" },
    ],
  },
  {
    title: "Guides",
    items: [
      { label: "Analytics for agents", href: "/for/agents" },
      { label: "Self-host", href: "/blog/self-host-counted-in-5-minutes" },
    ],
  },
  {
    title: "Resources",
    items: [
      { label: "OpenAPI spec", href: "/api/v0/openapi.json" },
      { label: "llms.txt", href: "/docs/llms.txt" },
    ],
  },
];

export function DocsSidebar() {
  const pathname = usePathname();
  return (
    <nav className="space-y-6 text-sm">
      {NAV.map((section) => (
        <div key={section.title}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">
            {section.title}
          </div>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const base = item.href.split("#")[0];
              const isAnchor = item.href.includes("#");
              const active = pathname === base && !isAnchor;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block rounded px-2 py-1 transition-colors ${
                      active
                        ? "bg-accent/10 text-accent"
                        : "text-text-secondary hover:text-text-primary hover:bg-surface-2/50"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
