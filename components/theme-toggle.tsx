"use client";

import { useEffect, useState } from "react";

function SunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M13.5 8.3A5.5 5.5 0 1 1 7.7 2.5a4.4 4.4 0 0 0 5.8 5.8Z" />
    </svg>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const [light, setLight] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setLight(document.documentElement.classList.contains("light"));
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    localStorage.setItem("theme", next ? "light" : "dark");
  }

  if (!mounted) return <div className={`w-8 h-8 ${className ?? ""}`} />;

  return (
    <button
      onClick={toggle}
      className={`p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-colors ${className ?? ""}`}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
    >
      {light ? <MoonIcon className="w-4 h-4" /> : <SunIcon className="w-4 h-4" />}
    </button>
  );
}
