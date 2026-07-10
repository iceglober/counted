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
      { label: "Self-host", href: "https://github.com/iceglober/counted#self-hosting" },
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
    <nav className="space-y-5 text-[12px]">
      {NAV.map((section) => (
        <div key={section.title}>
          <b className="block text-[11px] uppercase text-[#666] mb-1">{section.title}</b>
          <ul>
            {section.items.map((item) => {
              const base = item.href.split("#")[0];
              const isAnchor = item.href.includes("#");
              const active = pathname === base && !isAnchor;
              return (
                <li key={item.href} className="py-0.5">
                  {active ? (
                    <b>{item.label}</b>
                  ) : (
                    <Link href={item.href}>{item.label}</Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
