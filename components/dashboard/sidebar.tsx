"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CountedLogo } from "@/components/icons";
import { Layers, Zap, FolderOpen, Settings } from "lucide-react";
import { useProjects } from "./dashboard-shell";

const nav = [
  { label: "Dashboards", href: "", icon: Layers },
  { label: "Projects", href: "/projects", icon: FolderOpen },
  { label: "Events", href: "/events", icon: Zap },
];

export function Sidebar() {
  const pathname = usePathname();
  const projects = useProjects();
  const pathProjectId = pathname.split("/")[1];
  const currentProject = projects.find((p) => p.id === pathProjectId) ?? projects[0] ?? { id: "", name: "" };

  return (
    <aside className="w-56 shrink-0 border-r border-border bg-surface-1 flex flex-col h-screen sticky top-0">
      {/* Brand */}
      <div className="px-4 h-14 flex items-center gap-2.5 border-b border-border">
        <Link href="/" className="flex items-center gap-2.5">
          <CountedLogo className="w-5 h-5 text-accent" />
          <span className="font-display text-lg text-text-primary tracking-wide">Counted</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 space-y-0.5">
        {nav.map((item) => {
          const href = item.href === "/projects"
            ? "/projects"
            : `/${currentProject.id}${item.href}`;
          const active = item.href === "/projects"
            ? pathname === "/projects"
            : pathname === href || (item.href === "" && pathname === `/${currentProject.id}`);
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
      <div className="px-4 py-4 border-t border-border space-y-1">
        <Link
          href={`/${currentProject.id}/settings`}
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors"
        >
          <Settings className="w-4 h-4" />
          Settings
        </Link>
        <BuildTag />
      </div>
    </aside>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function BuildTag() {
  const [hovering, setHovering] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  return (
    <div className="px-2.5 pt-2 relative">
      <span
        className="text-[10px] text-text-tertiary/40 font-mono tabular-nums cursor-default"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      >
        {process.env.BUILD_ID}
      </span>
      {hovering && (
        <div
          style={{ position: "fixed", left: pos.x + 12, top: pos.y - 8, pointerEvents: "none", zIndex: 99999 }}
          className="px-2 py-1 text-xs font-medium text-accent bg-surface-2 border border-accent/20 rounded shadow-sm whitespace-nowrap"
        >
          Updated {timeAgo(process.env.BUILD_TIME ?? "")}
        </div>
      )}
    </div>
  );
}
