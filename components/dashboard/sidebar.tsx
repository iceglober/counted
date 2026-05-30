"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TallyMark, ChevronDown, BarChart, Hash, Settings, ExternalLink } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { projects } from "@/lib/mock-data";

const nav = [
  { label: "Dashboard", href: "", icon: BarChart },
  { label: "Events", href: "/events", icon: Hash },
];

export function Sidebar() {
  const pathname = usePathname();
  const [projectOpen, setProjectOpen] = useState(false);
  const [currentProject, setCurrentProject] = useState(projects[0]);

  return (
    <aside className="w-56 shrink-0 border-r border-border bg-surface-1 flex flex-col h-screen sticky top-0">
      {/* Brand */}
      <div className="px-4 h-14 flex items-center gap-2.5 border-b border-border">
        <TallyMark className="w-5 h-5 text-accent" />
        <span className="font-display text-lg text-text-primary tracking-wide">Counted</span>
      </div>

      {/* Project switcher */}
      <div className="px-3 py-3 border-b border-border relative">
        <button
          onClick={() => setProjectOpen(!projectOpen)}
          className="w-full flex items-center justify-between px-2.5 py-2 rounded-md bg-surface-2 hover:bg-surface-3 transition-colors text-sm"
        >
          <span className="text-text-primary truncate">{currentProject.name}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-text-tertiary transition-transform ${projectOpen ? "rotate-180" : ""}`} />
        </button>
        {projectOpen && (
          <div className="absolute left-3 right-3 top-full mt-1 bg-surface-2 border border-border rounded-md shadow-lg z-50 py-1">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => { setCurrentProject(p); setProjectOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  p.id === currentProject.id
                    ? "text-accent bg-accent/8"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-3"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 space-y-0.5">
        {nav.map((item) => {
          const href = `/${currentProject.id}${item.href}`;
          const active = pathname === href || (item.href === "" && pathname === `/${currentProject.id}`);
          return (
            <Link
              key={item.label}
              href={href}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors ${
                active
                  ? "text-accent bg-accent/8 border-l-2 border-accent -ml-[2px] pl-[calc(0.625rem+2px)]"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-2"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="px-3 py-3 border-t border-border space-y-0.5">
        <div className="flex items-center justify-between px-2.5 py-1">
          <span className="text-xs text-text-tertiary">Theme</span>
          <ThemeToggle />
        </div>
        <Link
          href={`/${currentProject.id}/settings`}
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors"
        >
          <Settings className="w-4 h-4" />
          Settings
        </Link>
        <a
          href="https://counted.dev/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          Docs
        </a>
      </div>
    </aside>
  );
}
