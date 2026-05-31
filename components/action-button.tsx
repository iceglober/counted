"use client";

import { useState, type ReactNode } from "react";

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
      >
        {icon}
      </button>
      {hovering && (
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
        </div>
      )}
    </>
  );
}
