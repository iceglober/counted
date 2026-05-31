"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";

type ThemeMode = "dark" | "light" | "auto";

export function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("theme") as ThemeMode | null;
    setMode(stored ?? "dark");
  }, []);

  function cycle() {
    const order: ThemeMode[] = ["dark", "light", "auto"];
    const next = order[(order.indexOf(mode) + 1) % order.length];
    setMode(next);
    localStorage.setItem("theme", next);
    applyTheme(next);
  }

  if (!mounted) return <div className={`w-8 h-8 ${className ?? ""}`} />;

  const Icon = mode === "light" ? Moon : mode === "auto" ? Monitor : Sun;

  return (
    <button
      onClick={cycle}
      className={`p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors ${className ?? ""}`}
      aria-label={`Theme: ${mode}`}
      title={`Theme: ${mode}`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

export function applyTheme(mode: ThemeMode) {
  const isLight = mode === "light" || (mode === "auto" && matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.classList.toggle("light", isLight);
}
