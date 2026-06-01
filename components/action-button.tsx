"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  label: string;
  onClick: () => void;
  icon: ReactNode;
  className?: string;
};

export function ActionButton({ label, onClick, icon, className }: Props) {
  const [hovering, setHovering] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  function handleMouseMove(e: React.MouseEvent) {
    setPos({ x: e.clientX, y: e.clientY });
  }

  return (
    <>
      <button
        onClick={onClick}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onMouseMove={handleMouseMove}
        className={className}
        aria-label={label}
        title={label}
      >
        {icon}
      </button>
      {hovering && typeof document !== "undefined" &&
        // Portal to the body so the tooltip escapes the grid item's transform
        // (a transformed ancestor makes position:fixed resolve against it, and
        // traps the tooltip under sibling cards).
        createPortal(
          <div
            style={{
              position: "fixed",
              left: pos.x + 12,
              top: pos.y - 8,
              pointerEvents: "none",
              zIndex: 99999,
            }}
            className="px-2 py-1 text-xs font-medium text-accent bg-surface-2 border border-accent/20 rounded shadow-sm whitespace-nowrap"
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}
