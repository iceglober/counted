"use client";

import { useRef, useEffect, useState, type ReactNode } from "react";

// Fades + lifts content in as it scrolls into view. The hidden state is applied
// only after mount, so server-rendered and no-JS users always see the content
// (and reduced-motion users get it instantly via the global media query).
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    setMounted(true);
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const hidden = mounted && !shown;

  return (
    <div ref={ref} className={`reveal ${hidden ? "reveal-hidden" : ""} ${className ?? ""}`}>
      {children}
    </div>
  );
}
